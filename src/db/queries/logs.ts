import { pipeline } from "stream/promises";
import { Readable, Writable } from "stream";
import { conn } from "../index.js";
import { db } from "../index.js"
import { logs } from "../schema.js"
import { logs_rollup1m } from "../schema.js";
import {sql, eq, and, or, ilike, desc, gte, lt } from "drizzle-orm";
import type {LogCopyItem} from "../../types/logs.js";
import type { LogFilters } from "../../types/logs.js"

function csvEscape(val: string): string {
    return `"${val.replace(/"/g, '""')}"`;
}

const YIELD_EVERY = 250;


function yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

async function* generateCSV(batch: LogCopyItem[]) {
    for (let i = 0; i < batch.length; i++) {
        const item = batch[i]!;
        const msg = item.message.replace(/[\r\n]/g, " ");
        const attrsRaw = typeof item.attributes === "string"
            ? item.attributes
            : JSON.stringify(item.attributes);
 
        yield [
            csvEscape(item.timestamp),
            csvEscape(item.level),
            csvEscape(item.service),
            csvEscape(msg),
            csvEscape(attrsRaw),
        ].join(",") + "\n";
 
        if (i > 0 && i % YIELD_EVERY === 0) {
            await yieldToEventLoop();
        }
    }
}

export async function copyLogsToDB(batch: LogCopyItem[]) {
    if(batch.length === 0 ){
        return;
    }
    
    const query = conn`COPY logs (timestamp, level, service, message, attributes)
                       FROM STDIN
                       WITH (FORMAT csv)`;
    const stream = await query.writable();
    try{
        await pipeline(Readable.from(generateCSV(batch)), stream);
        await query;
    } catch(err){
         console.error("[copyLogsToDB] COPY failed, batch rejected", {
            batchSize: batch.length,
            error: err instanceof Error ? err.message : err,
        });
        throw err;
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

function buildRollupRows(batch: LogCopyItem[]) {
  const counts = new Map<string, {
      bucket_start: Date;
      service: string;
      level: string;
      count: number;
    }
    >();

  for (const item of batch){
    const timestamp = new Date(item.timestamp);
    const bucket_start = new Date(Math.floor(timestamp.getTime() / 60000) * 60000);
    const key = `${bucket_start.toISOString()}|${item.service}|${item.level}`;
    const existing = counts.get(key);

    if (existing){
      existing.count++;
    } 
    else{
      counts.set(key, {
        bucket_start,
        service: item.service,
        level: item.level,
        count: 1,
      });
    }
  }
  return [...counts.values()];
}

export async function upsertRollup(batch: LogCopyItem[]) {
  const rows = buildRollupRows(batch);
  if (rows.length === 0) {
    return;
  }

  await db.insert(logs_rollup1m).values(rows).onConflictDoUpdate({
      target: [
        logs_rollup1m.bucket_start,
        logs_rollup1m.service,
        logs_rollup1m.level,
      ],
      set: {
        count: sql`${logs_rollup1m.count} + excluded.count`,
      },
    });
}