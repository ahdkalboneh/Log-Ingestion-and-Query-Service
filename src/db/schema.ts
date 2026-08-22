import { pgTable, bigint, timestamp, 
    text, jsonb, index, primaryKey} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const logs = pgTable("logs", {
  id: bigint("id", { mode: "number", }).generatedAlwaysAsIdentity(),
  timestamp: timestamp("timestamp", { withTimezone: true, }).notNull(),
  level: text("level").notNull(),
  service: text("service").notNull(),
  message: text("message").notNull(),
  attributes: jsonb("attributes").default({}),
  createdAt: timestamp("created_at", { withTimezone: true, }).defaultNow(),
},(table) => [
  primaryKey({
    name: "logs_pk",
    columns: [table.timestamp, table.id],
  }),
  index("idx_logs_service_level_time").on(table.service, table.level, table.timestamp.desc(), table.id.desc()),
  index("idx_logs_timestamp_id").on(table.timestamp.desc(), table.id.desc()),
  index("idx_logs_service_ts_id").on(table.service, table.timestamp.desc(), table.id.desc()),
]);


export const logMinuteAggregates = pgTable( "log_minute_aggregates", {
    bucketStart: timestamp("bucket_start", { withTimezone: true, }).notNull(),
    service: text("service").notNull(),
    level: text("level").notNull(),
    count: bigint("count", { mode: "number" }).notNull(),
  },
  (table) => [
   primaryKey({ columns: [ table.bucketStart, table.service, table.level,],}),

    
    index("log_minute_aggregates_service_bucket_idx").on( table.service, table.bucketStart ),
    index("log_minute_aggregates_level_bucket_idx").on(table.level,table.bucketStart),
  ]
);