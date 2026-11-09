CREATE TABLE "item_names" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"quality" smallint,
	"source" text NOT NULL,
	"build" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_names_source_check" CHECK ("item_names"."source" in ('wago', 'client'))
);
--> statement-breakpoint
CREATE TABLE "price_alerts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"direction" text NOT NULL,
	"threshold_copper" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_alerts_market_item_direction_key" UNIQUE("market_id","item_key","direction"),
	CONSTRAINT "price_alerts_direction_check" CHECK ("price_alerts"."direction" in ('below', 'above')),
	CONSTRAINT "price_alerts_threshold_check" CHECK ("price_alerts"."threshold_copper" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;