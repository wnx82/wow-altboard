CREATE TABLE "character_ledger_days" (
	"character_id" bigint NOT NULL,
	"machine_id" bigint NOT NULL,
	"day" date NOT NULL,
	"income" jsonb NOT NULL,
	"expense" jsonb NOT NULL,
	"transfer_in" bigint DEFAULT 0 NOT NULL,
	"transfer_out" bigint DEFAULT 0 NOT NULL,
	"loot_value" bigint,
	"gold" bigint,
	"played_seconds" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_ledger_days_character_id_machine_id_day_pk" PRIMARY KEY("character_id","machine_id","day"),
	CONSTRAINT "character_ledger_days_values_check" CHECK ("character_ledger_days"."transfer_in" >= 0 and "character_ledger_days"."transfer_out" >= 0 and "character_ledger_days"."loot_value" >= 0 and "character_ledger_days"."gold" >= 0 and "character_ledger_days"."played_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "character_ledger_days" ADD CONSTRAINT "character_ledger_days_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_ledger_days" ADD CONSTRAINT "character_ledger_days_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_ledger_days_day_idx" ON "character_ledger_days" USING btree ("day");