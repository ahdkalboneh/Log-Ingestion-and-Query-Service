-- Custom SQL migration file, put your code below! --
-- Drop the old table if needed or apply your partitioned table DDL
DROP TABLE IF EXISTS "logs" CASCADE;

CREATE TABLE "logs" (
    "id" bigint GENERATED ALWAYS AS IDENTITY,
    "timestamp" timestamp with time zone NOT NULL,
    "level" text NOT NULL,
    "service" text NOT NULL,
    "message" text NOT NULL,
    "attributes" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "logs_pk" PRIMARY KEY("timestamp","id")
) PARTITION BY RANGE (timestamp);

CREATE INDEX "idx_logs_service_level_time" ON "logs" USING btree ("service","level","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);
CREATE INDEX "idx_logs_timestamp_brin" ON "logs" USING brin ("timestamp");
CREATE INDEX "idx_logs_timestamp_id" ON "logs" USING btree ("timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);