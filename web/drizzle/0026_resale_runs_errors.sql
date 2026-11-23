-- Site 0.37.0 : revente (portefeuille et affaires d'EZAuctioneer), donjons d'Allemano Ledger et
-- erreurs Lua de l'addon AltBoard, envoyés par l'agent 0.11.0. Tables nouvelles seulement : rien
-- d'existant ne change. Retour arrière : supprimer les sept tables (aucune autre ne les référence).
CREATE TABLE "account_addon_errors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "account_addon_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"machine_id" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"message" text NOT NULL,
	"addon_version" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_runs" (
	"character_id" bigint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"stopped_at" timestamp with time zone,
	"duration_seconds" integer,
	"zone" text,
	"tag" text,
	"xp_gained" integer,
	"levels" smallint,
	"money_copper" bigint,
	"net_copper" bigint,
	"loot_value_copper" bigint,
	CONSTRAINT "character_runs_character_id_started_at_pk" PRIMARY KEY("character_id","started_at"),
	CONSTRAINT "character_runs_values_check" CHECK ("character_runs"."duration_seconds" >= 0 and "character_runs"."xp_gained" >= 0 and "character_runs"."levels" >= 0 and "character_runs"."loot_value_copper" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resale_auctions" (
	"portfolio_id" bigint NOT NULL,
	"auction_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_copper" bigint NOT NULL,
	"deposit_copper" bigint,
	"cut" double precision,
	"market_key" text,
	"posted_at" timestamp with time zone,
	CONSTRAINT "resale_auctions_portfolio_id_auction_id_pk" PRIMARY KEY("portfolio_id","auction_id"),
	CONSTRAINT "resale_auctions_values_check" CHECK ("resale_auctions"."quantity" > 0 and "resale_auctions"."unit_copper" >= 0 and "resale_auctions"."deposit_copper" >= 0 and "resale_auctions"."cut" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "resale_deals" (
	"scan_market_id" bigint NOT NULL,
	"rank" smallint NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text,
	"quantity" integer NOT NULL,
	"cost_copper" bigint NOT NULL,
	"resale_copper" bigint NOT NULL,
	"profit_copper" bigint NOT NULL,
	"roi" double precision NOT NULL,
	"listings" integer,
	"thin" boolean,
	"live" text,
	CONSTRAINT "resale_deals_scan_market_id_rank_pk" PRIMARY KEY("scan_market_id","rank"),
	CONSTRAINT "resale_deals_kind_check" CHECK ("resale_deals"."kind" in ('resale', 'vendor')),
	CONSTRAINT "resale_deals_values_check" CHECK ("resale_deals"."quantity" > 0 and "resale_deals"."cost_copper" >= 0 and "resale_deals"."resale_copper" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resale_events" (
	"portfolio_id" bigint NOT NULL,
	"entry_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"amount_copper" bigint,
	"fee_copper" bigint,
	"gain_copper" bigint,
	"unit_copper" bigint,
	"deposit_copper" bigint,
	"source" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resale_events_portfolio_id_entry_hash_pk" PRIMARY KEY("portfolio_id","entry_hash"),
	CONSTRAINT "resale_events_kind_check" CHECK ("resale_events"."kind" in ('buy', 'post', 'sale', 'pending', 'expire', 'cancel', 'unknown', 'remove')),
	CONSTRAINT "resale_events_values_check" CHECK ("resale_events"."quantity" >= 0 and "resale_events"."amount_copper" >= 0 and "resale_events"."fee_copper" >= 0 and "resale_events"."unit_copper" >= 0 and "resale_events"."deposit_copper" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resale_portfolios" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "resale_portfolios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"machine_id" bigint NOT NULL,
	"portfolio_key" text NOT NULL,
	"realm" text NOT NULL,
	"character_name" text NOT NULL,
	"character_id" bigint,
	"realized_copper" bigint NOT NULL,
	"sales" integer NOT NULL,
	"cuts_copper" bigint NOT NULL,
	"expired" integer NOT NULL,
	"deposits_lost_copper" bigint NOT NULL,
	"unknown_outcomes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resale_portfolios_account_machine_key_key" UNIQUE("account_id","machine_id","portfolio_key"),
	CONSTRAINT "resale_portfolios_values_check" CHECK ("resale_portfolios"."sales" >= 0 and "resale_portfolios"."cuts_copper" >= 0 and "resale_portfolios"."expired" >= 0 and "resale_portfolios"."deposits_lost_copper" >= 0 and "resale_portfolios"."unknown_outcomes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "resale_positions" (
	"portfolio_id" bigint NOT NULL,
	"item_key" text NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"cost_copper" bigint NOT NULL,
	"listed" integer NOT NULL,
	"opened_at" timestamp with time zone,
	CONSTRAINT "resale_positions_portfolio_id_item_key_pk" PRIMARY KEY("portfolio_id","item_key"),
	CONSTRAINT "resale_positions_values_check" CHECK ("resale_positions"."quantity" >= 0 and "resale_positions"."cost_copper" >= 0 and "resale_positions"."listed" >= 0)
);
--> statement-breakpoint
ALTER TABLE "account_addon_errors" ADD CONSTRAINT "account_addon_errors_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_addon_errors" ADD CONSTRAINT "account_addon_errors_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_runs" ADD CONSTRAINT "character_runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_auctions" ADD CONSTRAINT "resale_auctions_portfolio_id_resale_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."resale_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_deals" ADD CONSTRAINT "resale_deals_scan_market_id_scan_markets_id_fk" FOREIGN KEY ("scan_market_id") REFERENCES "public"."scan_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_events" ADD CONSTRAINT "resale_events_portfolio_id_resale_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."resale_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_portfolios" ADD CONSTRAINT "resale_portfolios_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_portfolios" ADD CONSTRAINT "resale_portfolios_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_portfolios" ADD CONSTRAINT "resale_portfolios_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resale_positions" ADD CONSTRAINT "resale_positions_portfolio_id_resale_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."resale_portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_addon_errors_account_idx" ON "account_addon_errors" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "resale_events_portfolio_occurred_idx" ON "resale_events" USING btree ("portfolio_id","occurred_at");