CREATE TABLE "icon_files" (
	"file_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"build" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
