CREATE TABLE "notification_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_snapshot_id" bigint NOT NULL,
	"last_check_id" bigint NOT NULL,
	"silent_machines" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_weekly_report" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_state_single_row_check" CHECK ("notification_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "notify_webhook_url" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "notify_webhook_token" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "notify_events" jsonb;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "notify_silent_days" smallint;--> statement-breakpoint
ALTER TABLE "character_goals" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
-- Atteintes antérieures aux notifications : déjà « annoncées », rien n'est envoyé pour elles.
UPDATE "character_goals" SET "notified_at" = "achieved_at" WHERE "achieved_at" IS NOT NULL;