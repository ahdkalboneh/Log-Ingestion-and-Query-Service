CREATE TABLE "log_minute_aggregates" (
	"bucket_start" timestamp with time zone NOT NULL,
	"service" text NOT NULL,
	"level" text NOT NULL,
	"count" bigint NOT NULL,
	CONSTRAINT "log_minute_aggregates_bucket_start_service_level_pk" PRIMARY KEY("bucket_start","service","level")
);
--> statement-breakpoint
CREATE INDEX "log_minute_aggregates_service_bucket_idx" ON "log_minute_aggregates" USING btree ("service","bucket_start");--> statement-breakpoint
CREATE INDEX "log_minute_aggregates_level_bucket_idx" ON "log_minute_aggregates" USING btree ("level","bucket_start");