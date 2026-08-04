import { pgTable, bigint, timestamp, 
    text, varchar, jsonb,} from "drizzle-orm/pg-core";

export const logs = pgTable("logs", {
  id: bigint("id", { mode: "number", }).primaryKey().generatedAlwaysAsIdentity(),
  timestamp: timestamp("timestamp", { withTimezone: true, }).notNull(),
  level: text("level").notNull(),
  service: varchar("service", { length: 64, }).notNull(),
  message: text("message").notNull(),
  attributes: jsonb("attributes").default({}),
  createdAt: timestamp("created_at", { withTimezone: true, }).defaultNow(),
});