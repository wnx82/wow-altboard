-- Site 0.34.0 : carnet saisi sur le site, note et étiquettes par personnage, listes à cocher
-- chaque jour ou chaque semaine, et heure de leur réinitialisation dans app_settings. Tables
-- nouvelles et deux colonnes facultatives : rien d'existant ne change. Retour arrière : supprimer
-- les cinq tables et les deux colonnes (aucune autre table ne les référence).
CREATE TABLE "character_notes" (
	"character_id" bigint PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_notes_body_check" CHECK (char_length("character_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "character_tags" (
	"character_id" bigint NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_tags_character_id_tag_pk" PRIMARY KEY("character_id","tag"),
	CONSTRAINT "character_tags_tag_check" CHECK (char_length("character_tags"."tag") between 1 and 24 and "character_tags"."tag" = lower("character_tags"."tag"))
);
--> statement-breakpoint
CREATE TABLE "checklist_checks" (
	"item_id" bigint NOT NULL,
	"character_id" bigint NOT NULL,
	"period_start" date NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_checks_item_id_character_id_period_start_pk" PRIMARY KEY("item_id","character_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "checklist_item_characters" (
	"item_id" bigint NOT NULL,
	"character_id" bigint NOT NULL,
	CONSTRAINT "checklist_item_characters_item_id_character_id_pk" PRIMARY KEY("item_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "checklist_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"label" text NOT NULL,
	"period" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_period_check" CHECK ("checklist_items"."period" in ('daily', 'weekly')),
	CONSTRAINT "checklist_items_label_check" CHECK (char_length("checklist_items"."label") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reset_hour" smallint;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "reset_weekday" smallint;--> statement-breakpoint
ALTER TABLE "character_notes" ADD CONSTRAINT "character_notes_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_tags" ADD CONSTRAINT "character_tags_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_checks" ADD CONSTRAINT "checklist_checks_item_id_character_id_checklist_item_characters_item_id_character_id_fk" FOREIGN KEY ("item_id","character_id") REFERENCES "public"."checklist_item_characters"("item_id","character_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item_characters" ADD CONSTRAINT "checklist_item_characters_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item_characters" ADD CONSTRAINT "checklist_item_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_tags_tag_idx" ON "character_tags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "checklist_item_characters_character_idx" ON "checklist_item_characters" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_reset_check" CHECK (("app_settings"."reset_hour" is null or "app_settings"."reset_hour" between 0 and 23) and ("app_settings"."reset_weekday" is null or "app_settings"."reset_weekday" between 1 and 7));