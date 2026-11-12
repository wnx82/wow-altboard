CREATE TABLE "character_holding_sources" (
	"character_id" bigint PRIMARY KEY NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_holdings" (
	"character_id" bigint NOT NULL,
	"location" text NOT NULL,
	"item_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "character_holdings_character_id_location_item_key_pk" PRIMARY KEY("character_id","location","item_key"),
	CONSTRAINT "character_holdings_location_check" CHECK ("character_holdings"."location" in ('mail', 'auctions')),
	CONSTRAINT "character_holdings_quantity_check" CHECK ("character_holdings"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guild_bank_items" (
	"guild_bank_id" bigint NOT NULL,
	"tab" smallint NOT NULL,
	"item_key" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "guild_bank_items_guild_bank_id_tab_item_key_pk" PRIMARY KEY("guild_bank_id","tab","item_key"),
	CONSTRAINT "guild_bank_items_quantity_check" CHECK ("guild_bank_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guild_banks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "guild_banks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" bigint NOT NULL,
	"name" text NOT NULL,
	"realm" text NOT NULL,
	"money_copper" bigint,
	"tab_names" jsonb NOT NULL,
	"file_modified_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_banks_money_copper_check" CHECK ("guild_banks"."money_copper" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_holding_sources" ADD CONSTRAINT "character_holding_sources_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_holdings" ADD CONSTRAINT "character_holdings_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_bank_items" ADD CONSTRAINT "guild_bank_items_guild_bank_id_guild_banks_id_fk" FOREIGN KEY ("guild_bank_id") REFERENCES "public"."guild_banks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_banks" ADD CONSTRAINT "guild_banks_account_id_wow_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wow_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_banks_account_guild_idx" ON "guild_banks" USING btree ("account_id","name","realm");