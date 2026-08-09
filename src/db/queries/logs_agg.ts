import { db } from "../index.js";
import { logs, logs_rollup1m, logs_rollup1h } from "../schema.js";
import { sql, eq, and, ilike, gte, lt } from "drizzle-orm";
import type { AggregateLogFilters } from "../../types/logs.js";

const BUCKETS = { "1m": "1 minute", "5m": "5 minutes", "1h": "1 hour", "1d": "1 day" } as const;
export async function aggregateLogsFromDB(filters: AggregateLogFilters){
  const canUseRollup =
    !filters.q &&
    !filters.attributes;

  if (canUseRollup) {
    return aggregateFromRollup(filters);
  }

  return aggregateFromRawLogs(filters);
}

export async function aggregateFromRawLogs(filters: AggregateLogFilters){
    let conditions = [
        gte(logs.timestamp, new Date(filters.since)),
        lt(logs.timestamp, new Date(filters.until)),
    ];

    if(filters.service){
        conditions.push(eq(logs.service ,filters.service));
    }

    if(filters.level){
        conditions.push(eq(logs.level ,filters.level));
    }

    if(filters.q){
        conditions.push(ilike(logs.message, `%${filters.q}%`));
    }

    if (filters.attributes) {
    for (const [k, v] of Object.entries(filters.attributes)) {
        conditions.push(sql`${logs.attributes} @> ${JSON.stringify({ [k]: v })}::jsonb`);
    }
    }

    const interval = BUCKETS[filters.bucket];
    const bucketExpression = sql`date_bin(${interval}::interval, ${logs.timestamp}, '1970-01-01'::timestamptz)`.as("start");
    const startRef = sql`start`;

    const groupExpression =
        filters.group_by === "service"
            ? logs.service
            : filters.group_by === "level"
                ? logs.level
                : undefined;

    const result = groupExpression
        ? await db
            .select({
                start: bucketExpression,
                group: groupExpression,
                count: sql<number>`count(*)::int`,
            })
            .from(logs)
            .where(and(...conditions))
            .groupBy(startRef, groupExpression)
            .orderBy(startRef)
        : await db
            .select({
                start: bucketExpression,
                count: sql<number>`count(*)::int`,
            })
            .from(logs)
            .where(and(...conditions))
            .groupBy(startRef)
            .orderBy(startRef);

    return result.map((row) => ({
        start: new Date(row.start as Date).toISOString(),
        group: "group" in row ? (row.group ?? null) : null,
        count: Number(row.count),
    }));
}

async function aggregateFromRollup(filters: AggregateLogFilters) {
  const rollup =
    filters.bucket === "1h"
      ? logs_rollup1h
      : logs_rollup1m;

  const conditions = [
    gte(rollup.bucket_start, new Date(filters.since)),
    lt(rollup.bucket_start, new Date(filters.until)),
  ];

  if (filters.service) {
    conditions.push(eq(rollup.service, filters.service));
  }

  if (filters.level) {
    conditions.push(eq(rollup.level, filters.level));
  }

  const groupExpression =
    filters.group_by === "service"
      ? rollup.service
      : filters.group_by === "level"
        ? rollup.level
        : undefined;

  const bucketExpression =
    filters.bucket === "1h"
      ? rollup.bucket_start
      : sql`
          date_bin(
            ${BUCKETS[filters.bucket]}::interval,
            ${rollup.bucket_start},
            '1970-01-01'::timestamptz
          )
        `.as("start");

  const startRef =
  filters.bucket === "1h"
    ? rollup.bucket_start
    : sql`start`;

  const result = groupExpression
    ? await db
        .select({
          start: bucketExpression,
          group: groupExpression,
          count: sql<number>`sum(${rollup.count})::int`,
        })
        .from(rollup)
        .where(and(...conditions))
        .groupBy(startRef, groupExpression)
        .orderBy(startRef)
    : await db
        .select({
          start: bucketExpression,
          count: sql<number>`sum(${rollup.count})::int`,
        })
        .from(rollup)
        .where(and(...conditions))
        .groupBy(startRef)
        .orderBy(startRef);

  return result.map((row) => ({
    start: new Date(row.start as Date).toISOString(),
    group: "group" in row ? row.group ?? null : null,
    count: Number(row.count),
  }));
}

