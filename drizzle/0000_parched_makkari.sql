CREATE TABLE "logs" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "logs_pk" PRIMARY KEY("timestamp","id")
);
--> statement-breakpoint
CREATE INDEX "idx_logs_service_level_time" ON "logs" USING btree ("service","level","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_logs_timestamp_brin" ON "logs" USING brin ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_logs_timestamp_id" ON "logs" USING btree ("timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);