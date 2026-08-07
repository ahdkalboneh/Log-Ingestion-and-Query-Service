import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { conn } from "../index.js";
import { db } from "../index.js"
import { logs } from "../schema.js"
import {sql, eq, and, ilike, desc, gte, lt } from "drizzle-orm";
import type {LogCopyItem} from "../../types/logs.js";
import type { LogFilters } from "../../types/logs.js"

function* generateTSV(batch: LogCopyItem[]) {
    for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        const cleanMsg = item!.message.replace(/[\r\n\t]/g, " ");
        yield `${item!.timestamp}\t${item!.level}\t${item!.service}\t${cleanMsg}\t${item!.attributes}\n`;
    }
}

export async function copyLogsToDB(batch: LogCopyItem[]) {
    if(batch.length === 0 ){
        return;
    }
    
    const stream = await conn.unsafe(`COPY logs (timestamp, level, service, message, attributes)
                       FROM STDIN
                       WITH (FORMAT text, DELIMITER E'\\t')`).writable();

    await pipeline(
        Readable.from(generateTSV(batch)),
        stream
    );

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
            lt(logs.timestamp, new Date(decoded.timestamp))
        );
    }
    if (filters.attributes){
        for (const [key, value] of Object.entries(filters.attributes)) {
            conditions.push(
                sql`${logs.attributes}->>${key} = ${value}`
            );
        }
    }

    const result = await db.select({id: logs.id,timestamp: logs.timestamp, level: logs.level, service: logs.service, message: logs.message, attributes: logs.attributes})
    .from(logs).where(conditions.length > 0 ? and (...conditions): undefined)
    .orderBy(desc(logs.timestamp), desc(logs.id))
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