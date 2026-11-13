ALTER TABLE "item_specs" ADD COLUMN "bonding" smallint;--> statement-breakpoint
-- La liaison manque aux lignes existantes : le prochain import, au démarrage, les reprend toutes.
UPDATE "item_specs" SET "build" = '';