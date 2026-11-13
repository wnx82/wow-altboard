CREATE TABLE "item_tooltips" (
	"item_key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"lines" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_tooltips_status_check" CHECK ("item_tooltips"."status" in ('ok', 'missing'))
);
