"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { parseAuctionCutInput, parseHistoryDayInput } from "@/lib/settings/input";
import { writeSettings } from "@/lib/settings/store";
import { deleteAlert, saveItemAlerts } from "./alerts";
import { askAssistant, assistantConfig, MAX_QUESTION_LENGTH } from "./assistant";
import { writeDailyAudit } from "./daily-audit";
import { loadFacts } from "./facts-service";
import { importItemNames } from "./item-names";
import { parseMoneyInput } from "./money-input";
import { cancelFarmSession, endFarmSession, MAX_LABEL_LENGTH, startFarmSession } from "./sessions";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/** Identifiant reçu d'un formulaire : seul un entier positif est accepté. */
const idField = (formData: FormData, name: string): number | null => {
  const value = field(formData, name);
  return /^[1-9]\d{0,14}$/.test(value) ? Number(value) : null;
};

export type EconomySettingsState = { error?: string; saved?: boolean; entered?: { historyFrom: string; auctionCut: string } };

/** Début de l'historique des prix et commission de l'hôtel des ventes. Vide : la valeur par défaut. */
export async function saveEconomySettingsAction(_previous: EconomySettingsState, formData: FormData): Promise<EconomySettingsState> {
  await requireSession();
  const now = new Date();
  const entered = { historyFrom: field(formData, "historyFrom").slice(0, 20), auctionCut: field(formData, "auctionCut").slice(0, 10) };
  const historyFrom = parseHistoryDayInput(entered.historyFrom, now);
  if (!historyFrom.ok) return { error: `Début de l'historique — ${historyFrom.error}`, entered };
  const auctionCut = parseAuctionCutInput(entered.auctionCut);
  if (!auctionCut.ok) return { error: auctionCut.error, entered };

  await writeSettings(getDatabase(), { marketHistoryFrom: historyFrom.value, auctionCutPercent: auctionCut.value }, now);
  console.log(JSON.stringify({ event: "settings.economy.saved", historyFrom: historyFrom.value?.toISOString() ?? null, auctionCut: auctionCut.value }));
  revalidatePath("/", "layout");
  return { saved: true };
}

export type FarmState = { error?: string; message?: string };

/** Démarre, termine ou abandonne une session de farm, selon le bouton du formulaire. */
export async function farmSessionAction(_previous: FarmState, formData: FormData): Promise<FarmState> {
  await requireSession();
  const db = getDatabase();
  const now = new Date();
  const intent = field(formData, "intent");

  let result;
  if (intent === "start") {
    const characterId = idField(formData, "characterId");
    if (characterId === null) return { error: "Choisissez un personnage." };
    const label = field(formData, "label").trim();
    if (label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) return { error: `Libellé invalide (${MAX_LABEL_LENGTH} caractères maximum).` };
    result = await startFarmSession(db, { characterId, label: label || null, now });
  } else if (intent === "end" || intent === "cancel") {
    const sessionId = idField(formData, "sessionId");
    if (sessionId === null) return { error: "Session introuvable." };
    result = intent === "end" ? await endFarmSession(db, { sessionId, now }) : await cancelFarmSession(db, sessionId);
  } else {
    return { error: "Action inconnue." };
  }
  if (!result.ok) return { error: result.error };

  console.log(JSON.stringify({ event: `farm.session.${intent}`, sessionId: result.id }));
  revalidatePath("/farming");
  return {
    message:
      intent === "start"
        ? "Session démarrée sur le dernier relevé des sacs. Farmez, puis /reload ou déconnectez-vous, synchronisez, et terminez la session."
        : intent === "end"
          ? "Session terminée et valorisée."
          : "Session abandonnée.",
  };
}

export type AssistantState = { error?: string; answer?: string; question?: string };

const ASSISTANT_LIMIT = { max: 10, windowMs: 10 * 60_000 };
const assistantLimiter = new RateLimiter();

/** Question à l'assistant : il ne reçoit que les faits du moteur, sa réponse est vérifiée. */
export async function askAssistantAction(_previous: AssistantState, formData: FormData): Promise<AssistantState> {
  const session = await requireSession();
  const question = field(formData, "question").trim().slice(0, MAX_QUESTION_LENGTH);
  if (!question) return { error: "Posez une question." };
  const config = assistantConfig();
  if (!config) return { error: "Assistant désactivé.", question };
  if (!assistantLimiter.consume(`assistant:${session.userId}`, ASSISTANT_LIMIT)) return { error: "Trop de questions. Réessayez dans quelques minutes.", question };

  const result = await loadFacts(getDatabase(), { marketId: idField(formData, "market") ?? undefined, now: new Date() });
  if (!result) return { error: "Données insuffisantes : aucun prix reçu.", question };
  const answer = await askAssistant(config, result.facts, question);
  console.log(JSON.stringify({ event: "assistant.answer", userId: session.userId, ok: answer.ok }));
  return answer.ok ? { answer: answer.answer, question } : { error: answer.error, question };
}

export type DailyAuditState = { error?: string; written?: boolean };

/** Un audit fait relire tous les faits au modèle : moins fréquent qu'une question. */
const AUDIT_LIMIT = { max: 5, windowMs: 10 * 60_000 };
const auditLimiter = new RateLimiter();

/** Rédige l'audit du jour du marché, ou le réécrit : faits du moteur seuls, réponse vérifiée. */
export async function writeDailyAuditAction(_previous: DailyAuditState, formData: FormData): Promise<DailyAuditState> {
  const session = await requireSession();
  const config = assistantConfig();
  if (!config) return { error: "Assistant désactivé." };
  if (!auditLimiter.consume(`audit:${session.userId}`, AUDIT_LIMIT)) return { error: "Trop de demandes. Réessayez dans quelques minutes." };

  const result = await writeDailyAudit(getDatabase(), config, { marketId: idField(formData, "market") ?? undefined, now: new Date() });
  console.log(JSON.stringify({ event: "assistant.audit", userId: session.userId, ok: result.ok, marketId: result.ok ? result.marketId : null }));
  if (!result.ok) return { error: result.error };
  revalidatePath("/opportunities");
  return { written: true };
}

export type AlertsState = { error?: string; saved?: boolean; entered?: { below: string; above: string } };

/** Seuils d'alerte d'un objet sur un marché ; un champ vide retire le seuil correspondant. */
export async function saveAlertsAction(_previous: AlertsState, formData: FormData): Promise<AlertsState> {
  await requireSession();
  const entered = { below: field(formData, "below").slice(0, 40), above: field(formData, "above").slice(0, 40) };
  const marketId = idField(formData, "market");
  if (marketId === null) return { error: "Marché introuvable.", entered };
  const below = parseMoneyInput(entered.below);
  if (!below.ok) return { error: `Seuil bas — ${below.error}`, entered };
  const above = parseMoneyInput(entered.above);
  if (!above.ok) return { error: `Seuil haut — ${above.error}`, entered };

  const result = await saveItemAlerts(getDatabase(), { marketId, itemKey: field(formData, "itemKey"), below: below.value, above: above.value, now: new Date() });
  if (!result.ok) return { error: result.error, entered };
  console.log(JSON.stringify({ event: "alerts.saved", marketId, saved: result.saved, removed: result.removed }));
  revalidatePath("/", "layout");
  return { saved: true };
}

export type DeleteAlertState = { error?: string };

export async function deleteAlertAction(_previous: DeleteAlertState, formData: FormData): Promise<DeleteAlertState> {
  await requireSession();
  const id = idField(formData, "alertId");
  if (id === null) return { error: "Alerte introuvable." };
  const deleted = await deleteAlert(getDatabase(), id);
  console.log(JSON.stringify({ event: "alerts.deleted", alertId: id, found: deleted !== null }));
  revalidatePath("/", "layout");
  return {};
}

export type ItemNamesState = { error?: string; message?: string };

/** Un import télécharge plusieurs mégaoctets chez wago.tools : quelques essais par quart d'heure. */
const ITEM_NAMES_LIMIT = { max: 3, windowMs: 15 * 60_000 };
const itemNamesLimiter = new RateLimiter();

/** Importe les noms des objets du jeu depuis wago.tools (version la plus récente du client). */
export async function importItemNamesAction(): Promise<ItemNamesState> {
  const session = await requireSession();
  if (!itemNamesLimiter.consume(`item-names:${session.userId}`, ITEM_NAMES_LIMIT)) return { error: "Trop d'imports. Réessayez dans quelques minutes." };
  const started = Date.now();
  const result = await importItemNames(getDatabase(), { now: new Date() });
  console.log(
    JSON.stringify({ event: "item_names.import", userId: session.userId, ok: result.ok, ms: Date.now() - started, ...(result.ok ? { build: result.build, count: result.count, removed: result.removed } : { error: result.error }) }),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  const removed = result.removed > 0 ? `, ${result.removed} retiré${result.removed > 1 ? "s" : ""}` : "";
  return { message: `${new Intl.NumberFormat("fr-FR").format(result.count)} noms importés (version ${result.build}${removed}).` };
}
