CREATE TABLE "character_goals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "character_goals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"character_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_goals_kind_check" CHECK ("character_goals"."kind" in ('manual', 'level', 'profession', 'reputation', 'item', 'gold', 'itemLevel', 'currency'))
);
--> statement-breakpoint
CREATE TABLE "goal_template_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goal_template_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"template_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "goal_template_items_kind_check" CHECK ("goal_template_items"."kind" in ('manual', 'level', 'profession', 'reputation', 'item', 'gold', 'itemLevel', 'currency'))
);
--> statement-breakpoint
CREATE TABLE "goal_templates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goal_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "character_goals" ADD CONSTRAINT "character_goals_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_template_items" ADD CONSTRAINT "goal_template_items_template_id_goal_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."goal_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_goals_character_idx" ON "character_goals" USING btree ("character_id","position");--> statement-breakpoint
CREATE INDEX "goal_template_items_template_idx" ON "goal_template_items" USING btree ("template_id","position");