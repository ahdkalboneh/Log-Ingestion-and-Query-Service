ALTER TABLE "logsRollup" RENAME TO "logsrollup";--> statement-breakpoint
ALTER TABLE "logsrollup" DROP CONSTRAINT "logsRollup_bucker_start_service_level_pk";--> statement-breakpoint
ALTER TABLE "logsrollup" ADD CONSTRAINT "logsrollup_bucker_start_service_level_pk" PRIMARY KEY("bucker_start","service","level");