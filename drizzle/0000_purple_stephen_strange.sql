DROP TABLE IF EXISTS "logs" CASCADE;
DROP SEQUENCE IF EXISTS "logs_id_seq" CASCADE;
CREATE TABLE "logs" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "logs_pk" PRIMARY KEY("timestamp","id")
) PARTITION BY RANGE ("timestamp");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "logs_default" PARTITION OF "logs" DEFAULT;

CREATE INDEX "idx_logs_service_level_time" ON "logs" USING btree ("service","level","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);