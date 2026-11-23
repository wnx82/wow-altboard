import { eq } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import { appSettings } from "@/db/schema";

// Réglages de la page Paramètres : une seule ligne en base, absente tant que rien n'a été réglé.

export type Settings = {
  /** Adresses surveillées, « hôte:port » séparées par des virgules. Null : celles de l'environnement. */
  statusAuthTargets: string | null;
  statusGameTargets: string | null;
  statusLabel: string | null;
  /** Date limite posée par la dernière réinitialisation des personnages. */
  charactersCutoffAt: Date | null;
  charactersResetAt: Date | null;
  /** Prix ignorés avant cette date. Null : la date limite des personnages s'applique. */
  marketHistoryFrom: Date | null;
  /** Commission de l'hôtel des ventes, en pourcentage. Null : 5 %. */
  auctionCutPercent: number | null;
  /** Réinitialisation des listes à cocher (heure de Bruxelles, jour 1 lundi à 7 dimanche). Null : 5 h, mercredi. */
  resetHour: number | null;
  resetWeekday: number | null;
};

const DEFAULTS: Settings = {
  statusAuthTargets: null,
  statusGameTargets: null,
  statusLabel: null,
  charactersCutoffAt: null,
  charactersResetAt: null,
  marketHistoryFrom: null,
  auctionCutPercent: null,
  resetHour: null,
  resetWeekday: null,
};

export async function readSettings(db: DatabaseOrTransaction): Promise<Settings> {
  const [row] = await db
    .select({
      statusAuthTargets: appSettings.statusAuthTargets,
      statusGameTargets: appSettings.statusGameTargets,
      statusLabel: appSettings.statusLabel,
      charactersCutoffAt: appSettings.charactersCutoffAt,
      charactersResetAt: appSettings.charactersResetAt,
      marketHistoryFrom: appSettings.marketHistoryFrom,
      auctionCutPercent: appSettings.auctionCutPercent,
      resetHour: appSettings.resetHour,
      resetWeekday: appSettings.resetWeekday,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  return row ?? DEFAULTS;
}

/** Écrit les réglages fournis ; les autres gardent leur valeur. */
export async function writeSettings(db: DatabaseOrTransaction, values: Partial<Settings>, now: Date): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: 1, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...values, updatedAt: now } });
}
