CREATE INDEX IF NOT EXISTS "idx_logs_service_ts_id" ON "logs" USING btree ("service","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);
