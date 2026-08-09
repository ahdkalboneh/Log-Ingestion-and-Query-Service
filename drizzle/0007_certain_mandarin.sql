CREATE TABLE "logs_rollup1h" (
	"bucket_start" timestamp with time zone NOT NULL,
	"service" varchar(64) NOT NULL,
	"level" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "logs_rollup1h_bucket_start_service_level_pk" PRIMARY KEY("bucket_start","service","level")
);
--> statement-breakpoint
ALTER TABLE "logsrollup" RENAME TO "logs_rollup1m";--> statement-breakpoint
ALTER TABLE "logs_rollup1m" DROP CONSTRAINT "logsrollup_bucket_start_service_level_pk";--> statement-breakpoint
ALTER TABLE "logs_rollup1m" ADD CONSTRAINT "logs_rollup1m_bucket_start_service_level_pk" PRIMARY KEY("bucket_start","service","level");