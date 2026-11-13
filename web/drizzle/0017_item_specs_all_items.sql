ALTER TABLE "item_specs" DROP CONSTRAINT "item_specs_class_check";--> statement-breakpoint
-- Les lignes existantes ne décrivent que l'équipement : le prochain import, au démarrage, les reprend toutes.
UPDATE "item_specs" SET "build" = '';