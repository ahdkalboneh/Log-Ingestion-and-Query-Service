ALTER TABLE "logsrollup" RENAME COLUMN "bucker_start" TO "bucket_start";--> statement-breakpoint
ALTER TABLE "logsrollup" DROP CONSTRAINT "logsrollup_bucker_start_service_level_pk";--> statement-breakpoint
ALTER TABLE "logsrollup" ADD CONSTRAINT "logsrollup_bucket_start_service_level_pk" PRIMARY KEY("bucket_start","service","level");