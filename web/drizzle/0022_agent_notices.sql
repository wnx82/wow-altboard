-- Site 0.29.0 : les personnages que Baganator connaît et qu'AltBoard n'a jamais vus sont une information
-- (agent_notice), plus un avertissement. L'historique est reclassé de même, avec l'état et le nombre
-- d'erreurs des synchronisations concernées. Retour arrière : remettre ces lignes en agent_warning.
UPDATE "sync_errors" SET "code" = 'agent_notice'
WHERE "code" = 'agent_warning' AND "message" ~ '^Baganator : [0-9]+ personnages? absents? d''AltBoard sur ce compte';--> statement-breakpoint
UPDATE "sync_runs" AS "r" SET
  "errors_count" = (SELECT count(*) FROM "sync_errors" AS "e" WHERE "e"."sync_run_id" = "r"."id" AND "e"."code" <> 'agent_notice'),
  "status" = CASE
    WHEN EXISTS (SELECT 1 FROM "sync_errors" AS "e" WHERE "e"."sync_run_id" = "r"."id" AND "e"."code" <> 'agent_notice') THEN 'partial'
    ELSE 'success'
  END
WHERE "r"."status" = 'partial'
  AND EXISTS (SELECT 1 FROM "sync_errors" AS "e" WHERE "e"."sync_run_id" = "r"."id" AND "e"."code" = 'agent_notice');
