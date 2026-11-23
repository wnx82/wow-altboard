-- Site 0.36.0 : alertes de prix annoncées au webhook des notifications. notified_at retient qu'un
-- franchissement de seuil a été annoncé ; null : l'alerte est armée. Les alertes existantes sont
-- tenues pour annoncées : un seuil déjà franchi au déploiement ne part pas (le passage suivant
-- réarme celles qui ne le sont pas). Le nouvel événement « price » est coché quand une liste
-- d'événements est déjà enregistrée. Retour arrière : supprimer la colonne et retirer « price »
-- de app_settings.notify_events.
ALTER TABLE "price_alerts" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "price_alerts" SET "notified_at" = now();--> statement-breakpoint
UPDATE "app_settings" SET "notify_events" = "notify_events" || '["price"]'::jsonb WHERE "notify_events" IS NOT NULL AND NOT ("notify_events" @> '["price"]'::jsonb);
