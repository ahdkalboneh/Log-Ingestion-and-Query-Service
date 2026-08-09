CREATE TABLE "logsRollup" (
	"bucker_start" timestamp with time zone NOT NULL,
	"service" varchar(64) NOT NULL,
	"level" text NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "logsRollup_bucker_start_service_level_pk" PRIMARY KEY("bucker_start","service","level")
);
