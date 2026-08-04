CREATE TABLE "logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"service" varchar(64) NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
