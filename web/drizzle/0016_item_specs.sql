CREATE TABLE "item_specs" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"item_class" smallint NOT NULL,
	"subclass" smallint NOT NULL,
	"inventory_type" smallint NOT NULL,
	"item_level" smallint,
	"required_level" smallint,
	"allowable_class" integer,
	"level_source" text,
	"build" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_specs_class_check" CHECK ("item_specs"."item_class" in (2, 4)),
	CONSTRAINT "item_specs_level_source_check" CHECK ("item_specs"."level_source" in ('wowf', 'era'))
);
