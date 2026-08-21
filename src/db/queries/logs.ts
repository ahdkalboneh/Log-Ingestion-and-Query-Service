import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { writeConn, readConn } from "../index.js";
import { db } from "../index.js"
import { logs } from "../schema.js"
import {sql, eq, and, or, ilike, gte, lt } from "drizzle-orm";
import type {LogCopyItem} from "../../types/logs.js";
import type { LogFilters } from "../../types/logs.js"

function csvEscape(val: string): string {
    if (!val.includes('"')) {
        return `"${val}"`;
    }
    return `"${val.replace(/"/g, '""')}"`;
}

async function* generateCSV(batch: LogCopyItem[]) {
    let chunk = "";
    for (let i = 0; i < batch.length; i++) {
        const item = batch[i]!;
        const raw = item.message;
        const msg = raw.includes("\n") || raw.includes("\r") ? raw.replace(/[\r\n]/g, " ") : raw;
        const attrsRaw = item.attributes;
        chunk += `${csvEscape(item.timestamp)},${csvEscape(item.level)},${csvEscape(item.service)},${csvEscape(msg)},${csvEscape(attrsRaw)}\n`; 
        if (chunk.length >= 256 * 1024) {
            yield chunk;
            chunk = "";
        }
    }
    if (chunk.length > 0) {
        yield chunk;
    }
}


export async function copyLogsToDB(batch: LogCopyItem[]) {
    if(batch.length === 0 ){
        return;
    }
    
    const query = writeConn`COPY logs (timestamp, level, service, message, attributes)
                       FROM STDIN
                       WITH (FORMAT csv)`;
    const stream = await query.writable();
    stream.on("error", () => {});

    try{
        await pipeline(Readable.from(generateCSV(batch)), stream);
        await query;
        await updateMinuteAggregates(batch);
    } catch(err){
         console.error("[copyLogsToDB] COPY failed, batch rejected", {
            batchSize: batch.length,
            error: err instanceof Error ? err.message : err,
        });

        if (!stream.destroyed) {
            stream.destroy(err instanceof Error ? err : new Error(String(err)));
        }
        throw err;
    } 
}
async function updateMinuteAggregates(batch: LogCopyItem[]) {
  const groups = new Map<string, {
    bucketStart: Date;
    service: string;
    level: string;
    count: number;
  }>();

  for (const item of batch) {
    const key = `${item.bucketEpoch}|${item.service}|${item.level}`;

    const existing = groups.get(key);

    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        bucketStart: new Date(item.bucketEpoch),
        service: item.service,
        level: item.level,
        count: 1,
      });
    }
  }

  const rows = [...groups.values()]
    .sort((a, b) =>
      a.bucketStart.getTime() - b.bucketStart.getTime() ||
      a.service.localeCompare(b.service) ||
      a.level.localeCompare(b.level)
    )
    .map((g) => ({
      bucket_start: g.bucketStart,
      service: g.service,
      level: g.level,
      count: g.count,
    }));

  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await writeConn`
      INSERT INTO log_minute_aggregates ${writeConn(chunk, "bucket_start", "service", "level", "count")}
      ON CONFLICT (bucket_start, service, level)
      DO UPDATE SET
        count = log_minute_aggregates.count + EXCLUDED.count
    `;
  }
}

export async function queryLogsFromDB(filters: LogFilters) {

    const conditions = [];

    if(filters.service){
        conditions.push(eq(logs.service, filters.service));
    }
    if(filters.level){
        conditions.push(eq(logs.level, filters.level));
    }
    if(filters.since){
        conditions.push(gte(logs.timestamp, new Date(filters.since)));
    }
    if(filters.until){
        conditions.push(lt(logs.timestamp, new Date(filters.until)));
    }
    if(filters.q){
        conditions.push(ilike(logs.message, `%${filters.q}%`));
    }
    if (filters.cursor) {
        const decoded = JSON.parse(
            Buffer.from(filters.cursor, "base64").toString()
        );
        conditions.push(
            or(
                lt(logs.timestamp, new Date(decoded.timestamp)),
                and(
                    eq(logs.timestamp, new Date(decoded.timestamp)),
                    lt(logs.id, decoded.id)
                )
            )
        );
    }
    if (filters.attributes){
        for (const [key, value] of Object.entries(filters.attributes)) {
            conditions.push(
                    sql`${logs.attributes} @> ${JSON.stringify({ [key]: value })}::jsonb`
                );
        }
    }

    const result = await db.select({id: logs.id,timestamp: logs.timestamp, level: logs.level, service: logs.service, message: logs.message, attributes: logs.attributes})
    .from(logs).where(conditions.length > 0 ? and (...conditions): undefined)
    .orderBy(
    sql`${logs.timestamp} desc nulls last`,
    sql`${logs.id} desc nulls last`)
    .limit(Number(filters.limit)+1);
    const hasMore = result.length > Number(filters.limit);

    let next_cursor = null;
    if (hasMore) {
        const lastLog = result[Number(filters.limit) - 1]!;
        next_cursor = Buffer.from(
            JSON.stringify({
                id: lastLog.id,
                timestamp: lastLog.timestamp
            })
        ).toString("base64");
    }

    return {
        logs: result.slice(0, Number(filters.limit)),
        next_cursor
    };
}
