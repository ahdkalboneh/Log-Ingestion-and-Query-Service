import { pgTable, bigint, timestamp, 
    text, varchar, jsonb, index} from "drizzle-orm/pg-core";

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
  index("idx_logs_attributes").using("gin", table.attributes),
]);