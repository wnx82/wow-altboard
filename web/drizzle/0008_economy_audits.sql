CREATE TABLE "economy_audits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "economy_audits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"market_id" bigint NOT NULL,
	"day" date NOT NULL,
	"run_id" bigint,
	"data_through" date,
	"model" text NOT NULL,
	"text" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	CONSTRAINT "economy_audits_market_day_key" UNIQUE("market_id","day")
);
--> statement-breakpoint
ALTER TABLE "economy_audits" ADD CONSTRAINT "economy_audits_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_audits" ADD CONSTRAINT "economy_audits_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE set null ON UPDATE no action;