import { pgTable, bigint, timestamp, 
    text, jsonb, index, primaryKey} from "drizzle-orm/pg-core";

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
  index("idx_logs_timestamp_brin").using("brin", table.timestamp),
  index("idx_logs_timestamp_id").on(table.timestamp.desc(), table.id.desc()),
]);

