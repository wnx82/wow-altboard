CREATE TABLE "item_icons" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"build" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
