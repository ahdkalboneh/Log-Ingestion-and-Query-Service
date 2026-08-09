import { pgTable, bigint, timestamp, 
    text, varchar, jsonb, index, primaryKey} from "drizzle-orm/pg-core";

export const logs = pgTable("logs", {
  id: bigint("id", { mode: "number", }).primaryKey().generatedAlwaysAsIdentity(),
  timestamp: timestamp("timestamp", { withTimezone: true, }).notNull(),
  level: text("level").notNull(),
  service: varchar("service", { length: 64, }).notNull(),
  message: text("message").notNull(),
  attributes: jsonb("attributes").default({}),
  createdAt: timestamp("created_at", { withTimezone: true, }).defaultNow(),
},(table) => [
  index("idx_logs_service_level_time").on(table.service, table.level, table.timestamp.desc(), table.id.desc()),
  index("idx_logs_timestamp_brin").using("brin", table.timestamp),
  index("idx_logs_timestamp_id").on(table.timestamp.desc(), table.id.desc()),
  index("idx_logs_service_time").on(table.service, table.timestamp.desc(), table.id.desc()),
  index("idx_logs_level_time").on(table.level, table.timestamp.desc(), table.id.desc()),
]);

export const logs_rollup1m = pgTable("logs_rollup1m",{
  bucket_start: timestamp("bucket_start", { withTimezone:true, }).notNull(),
  service: varchar("service", { length: 64, }).notNull(),
  level: text("level").notNull(),
  count: bigint("count", { mode: "number", }).notNull().default(0),
},
  (table) => [
    primaryKey({ columns: [table.bucket_start, table.service, table.level] }),
  ]
);

export const logs_rollup1h = pgTable("logs_rollup1h",{
  bucket_start: timestamp("bucket_start", { withTimezone:true, }).notNull(),
  service: varchar("service", { length: 64, }).notNull(),
  level: text("level").notNull(),
  count: bigint("count", { mode: "number", }).notNull().default(0),
},
  (table) => [
    primaryKey({ columns: [table.bucket_start, table.service, table.level] }),
  ]
);
