import { desc, eq } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { askAssistant, type AssistantConfig } from "./assistant";
import { todayInBrussels } from "./days";
import { loadFacts } from "./facts-service";

// Audit du jour (P11) : l'assistant rédige un bilan du marché à partir des seuls faits du moteur,
// avec la même vérification que ses réponses (aucun nombre hors des faits). Un audit par marché et
// par jour, conservé : le relire ne rappelle pas l'assistant, le réécrire remplace celui du jour.

/** Les numéros 1 à 5 sont toujours admis dans une réponse : la consigne n'ajoute aucun nombre aux faits. */
export const AUDIT_QUESTION = [
  // Essai réel (qwen3.5:9b, 2026-11-08) : sans « ligne vide », un seul paragraphe pour les cinq points.
  "Rédige l'audit économique du jour : un court paragraphe par point, séparés par une ligne vide, sans titre ni numéro.",
  "1. fraîcheur des données : date du dernier relevé et nombre d'objets suivis ;",
  "2. les meilleures opportunités, chacune avec sa confiance ;",
  "3. les crafts à éviter ;",
  "4. les hausses, baisses et anomalies notables, présentées comme des constats et non comme des recommandations ;",
  "5. ce que les faits ne permettent pas de conclure.",
].join("\n");

export const AUDITS_SHOWN = 8;

export type DailyAudit = {
  day: string;
  runId: number | null;
  dataThrough: string | null;
  model: string;
  text: string;
  writtenAt: Date;
};

const columns = {
  day: t.economyAudits.day,
  runId: t.economyAudits.runId,
  dataThrough: t.economyAudits.dataThrough,
  model: t.economyAudits.model,
  text: t.economyAudits.text,
  writtenAt: t.economyAudits.writtenAt,
};

/** Rédige l'audit du jour d'un marché et le conserve, à la place de celui déjà écrit ce jour-là. */
export async function writeDailyAudit(
  db: Database,
  config: AssistantConfig,
  options: { marketId?: number; now: Date },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; marketId: number; audit: DailyAudit } | { ok: false; error: string }> {
  const loaded = await loadFacts(db, options);
  if (!loaded) return { ok: false, error: "Données insuffisantes : aucun prix reçu." };
  const answer = await askAssistant(config, loaded.facts, AUDIT_QUESTION, fetchImpl);
  if (!answer.ok) return answer;

  const audit = {
    day: todayInBrussels(options.now),
    runId: loaded.run.id,
    dataThrough: loaded.run.dataThrough,
    model: config.model,
    text: answer.answer,
    writtenAt: options.now,
  };
  const [saved] = await db
    .insert(t.economyAudits)
    .values({ marketId: loaded.context.market.id, ...audit })
    .onConflictDoUpdate({
      target: [t.economyAudits.marketId, t.economyAudits.day],
      set: { runId: audit.runId, dataThrough: audit.dataThrough, model: audit.model, text: audit.text, writtenAt: audit.writtenAt },
    })
    .returning(columns);
  return { ok: true, marketId: loaded.context.market.id, audit: saved };
}

/** Derniers audits d'un marché, le plus récent d'abord. */
export async function listDailyAudits(db: DatabaseOrTransaction, marketId: number, limit = AUDITS_SHOWN): Promise<DailyAudit[]> {
  return db.select(columns).from(t.economyAudits).where(eq(t.economyAudits.marketId, marketId)).orderBy(desc(t.economyAudits.day)).limit(limit);
}
