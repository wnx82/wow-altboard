-- Site 0.38.0 : prix de l'hôtel des ventes de NaowhForever (dernier scan et historique de chaque
-- maison, flux de prix livré avec l'addon), envoyés par l'agent 0.12.0. Tables nouvelles seulement :
-- rien d'existant ne change. Retour arrière : supprimer les six tables (aucune autre ne les référence).
CREATE TABLE "naowh_feed_houses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "naowh_feed_houses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flavor" text NOT NULL,
	"region" integer NOT NULL,
	"blizzard_house_id" integer NOT NULL,
	"faction" text NOT NULL,
	"feed_time" timestamp with time zone NOT NULL,
	"file_hash" text NOT NULL,
	"items_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naowh_feed_houses_flavor_region_house_key" UNIQUE("flavor","region","blizzard_house_id"),
	CONSTRAINT "naowh_feed_houses_faction_check" CHECK ("naowh_feed_houses"."faction" in ('Alliance', 'Horde', 'Blackwater'))
);
--> statement-breakpoint
CREATE TABLE "naowh_feed_prices" (
	"feed_house_id" bigint NOT NULL,
	"item_id" integer NOT NULL,
	"low_copper" bigint NOT NULL,
	"median_copper" bigint,
	"listed" integer,
	CONSTRAINT "naowh_feed_prices_feed_house_id_item_id_pk" PRIMARY KEY("feed_house_id","item_id"),
	CONSTRAINT "naowh_feed_prices_values_check" CHECK ("naowh_feed_prices"."low_copper" > 0 and ("naowh_feed_prices"."median_copper" is null or "naowh_feed_prices"."median_copper" > 0) and ("naowh_feed_prices"."listed" is null or "naowh_feed_prices"."listed" >= 0))
);
--> statement-breakpoint
CREATE TABLE "naowh_houses" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "naowh_houses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flavor" text NOT NULL,
	"house_key" text NOT NULL,
	"realm" text NOT NULL,
	"side" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naowh_houses_flavor_house_key_key" UNIQUE("flavor","house_key"),
	CONSTRAINT "naowh_houses_side_check" CHECK ("naowh_houses"."side" in ('Alliance', 'Horde', 'Blackwater'))
);
--> statement-breakpoint
CREATE TABLE "naowh_imports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "naowh_imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"house_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"machine_id" bigint,
	"sync_run_id" bigint,
	"content_hash" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"scanned_at" timestamp with time zone,
	"items_count" integer NOT NULL,
	"days_count" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naowh_imports_house_account_content_key" UNIQUE("house_id","account_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "naowh_price_days" (
	"house_id" bigint NOT NULL,
	"item_id" integer NOT NULL,
	"day" date NOT NULL,
	"median_copper" bigint NOT NULL,
	"listed" integer,
	"recorded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naowh_price_days_house_id_item_id_day_pk" PRIMARY KEY("house_id","item_id","day"),
	CONSTRAINT "naowh_price_days_values_check" CHECK ("naowh_price_days"."median_copper" > 0 and ("naowh_price_days"."listed" is null or "naowh_price_days"."listed" >= 0))
);
--> statement-breakpoint
CREATE TABLE "naowh_prices" (
	"house_id" bigint NOT NULL,
	"item_id" integer NOT NULL,
	"low_copper" bigint,
	"listed" integer,
	"priced_at" timestamp with time zone,
	"median_copper" bigint,
	"median_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "naowh_prices_house_id_item_id_pk" PRIMARY KEY("house_id","item_id"),
	CONSTRAINT "naowh_prices_values_check" CHECK (("naowh_prices"."low_copper" is null or "naowh_prices"."low_copper" > 0) and ("naowh_prices"."median_copper" is null or "naowh_prices"."median_copper" > 0) and ("naowh_prices"."listed" is null or "naowh_prices"."listed" >= 0) and ("naowh_prices"."low_copper" is not null or "naowh_prices"."median_copper" is not null))
);
--> statement-breakpoint
ALTER TABLE "naowh_feed_prices" ADD CONSTRAINT "naowh_feed_prices_feed_house_id_naowh_feed_houses_id_fk" FOREIGN KEY ("feed_house_id") REFERENCES "public"."naowh_feed_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_imports" ADD CONSTRAINT "naowh_imports_house_id_naowh_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."naowh_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_imports" ADD CONSTRAINT "naowh_imports_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_imports" ADD CONSTRAINT "naowh_imports_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_imports" ADD CONSTRAINT "naowh_imports_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_price_days" ADD CONSTRAINT "naowh_price_days_house_id_naowh_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."naowh_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "naowh_prices" ADD CONSTRAINT "naowh_prices_house_id_naowh_houses_id_fk" FOREIGN KEY ("house_id") REFERENCES "public"."naowh_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "naowh_imports_account_idx" ON "naowh_imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "naowh_imports_sync_run_idx" ON "naowh_imports" USING btree ("sync_run_id");--> statement-breakpoint
CREATE INDEX "naowh_price_days_house_day_idx" ON "naowh_price_days" USING btree ("house_id","day");