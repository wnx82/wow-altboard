-- Site 0.31.0 : relevés de chaque scan de l'hôtel des ventes par l'addon EZAuctioneer (agent 0.10.0),
-- à côté des prix journaliers d'Auctionator. Tables nouvelles seulement : rien d'existant ne change.
-- Retour arrière : supprimer les cinq tables (aucune autre ne les référence).
CREATE TABLE "market_item_scan_days" (
	"scan_market_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"day" date NOT NULL,
	"low_copper" bigint NOT NULL,
	"median_copper" bigint NOT NULL,
	"high_copper" bigint NOT NULL,
	"max_units" integer NOT NULL,
	"scans" integer NOT NULL,
	CONSTRAINT "market_item_scan_days_scan_market_id_item_key_day_pk" PRIMARY KEY("scan_market_id","item_key","day"),
	CONSTRAINT "market_item_scan_days_values_check" CHECK ("market_item_scan_days"."low_copper" > 0 and "market_item_scan_days"."low_copper" <= "market_item_scan_days"."median_copper" and "market_item_scan_days"."median_copper" <= "market_item_scan_days"."high_copper" and "market_item_scan_days"."max_units" >= 0 and "market_item_scan_days"."scans" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_item_scans" (
	"scan_market_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"price_copper" bigint NOT NULL,
	"units" integer NOT NULL,
	CONSTRAINT "market_item_scans_scan_market_id_item_key_scanned_at_pk" PRIMARY KEY("scan_market_id","item_key","scanned_at"),
	CONSTRAINT "market_item_scans_values_check" CHECK ("market_item_scans"."price_copper" > 0 and "market_item_scans"."units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "market_scans" (
	"scan_market_id" bigint NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"auctions" integer,
	"listed_items" integer,
	"origin" text,
	"sampled_items" integer DEFAULT 0 NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_scans_scan_market_id_scanned_at_pk" PRIMARY KEY("scan_market_id","scanned_at"),
	CONSTRAINT "market_scans_counts_check" CHECK ("market_scans"."auctions" >= 0 and "market_scans"."listed_items" >= 0 and "market_scans"."sampled_items" >= 0 and "market_scans"."units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scan_imports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scan_imports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scan_market_id" bigint NOT NULL,
	"account_id" bigint NOT NULL,
	"machine_id" bigint,
	"sync_run_id" bigint,
	"content_hash" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"items_count" integer NOT NULL,
	"samples_count" integer NOT NULL,
	"first_scan_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_imports_market_account_content_key" UNIQUE("scan_market_id","account_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "scan_markets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scan_markets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flavor" text NOT NULL,
	"market_key" text NOT NULL,
	"region" text NOT NULL,
	"realm" text NOT NULL,
	"house" text NOT NULL,
	"faction" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_markets_flavor_market_key_key" UNIQUE("flavor","market_key"),
	CONSTRAINT "scan_markets_house_check" CHECK (("scan_markets"."house" = 'faction' and "scan_markets"."faction" is not null) or ("scan_markets"."house" = 'neutral' and "scan_markets"."faction" is null))
);
--> statement-breakpoint
ALTER TABLE "market_item_scan_days" ADD CONSTRAINT "market_item_scan_days_scan_market_id_scan_markets_id_fk" FOREIGN KEY ("scan_market_id") REFERENCES "public"."scan_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_item_scans" ADD CONSTRAINT "market_item_scans_scan_market_id_scan_markets_id_fk" FOREIGN KEY ("scan_market_id") REFERENCES "public"."scan_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_scans" ADD CONSTRAINT "market_scans_scan_market_id_scan_markets_id_fk" FOREIGN KEY ("scan_market_id") REFERENCES "public"."scan_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_imports" ADD CONSTRAINT "scan_imports_scan_market_id_scan_markets_id_fk" FOREIGN KEY ("scan_market_id") REFERENCES "public"."scan_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_imports" ADD CONSTRAINT "scan_imports_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_imports" ADD CONSTRAINT "scan_imports_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_imports" ADD CONSTRAINT "scan_imports_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_item_scans_market_scanned_idx" ON "market_item_scans" USING btree ("scan_market_id","scanned_at");--> statement-breakpoint
CREATE INDEX "scan_imports_account_idx" ON "scan_imports" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "scan_imports_sync_run_idx" ON "scan_imports" USING btree ("sync_run_id");