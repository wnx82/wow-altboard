import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { readSettings } from "@/lib/settings/store";
import { historyStart } from "./load";
import { ITEM_KEY_PATTERN } from "./view";

// Alertes de prix : un seuil bas (« prévenir sous 12 po ») et un seuil haut par objet et par marché,
// comparés au dernier prix relevé (champ m d'Auctionator, table market_item_latest). Aucune
// notification ni état : le résultat se relit à chaque affichage (fiche de l'objet, Marché, accueil).

export const ALERT_DIRECTIONS = ["below", "above"] as const;
export type AlertDirection = (typeof ALERT_DIRECTIONS)[number];

/** Au-delà, une nouvelle alerte est refusée : la liste de la page Marché reste lisible. */
export const MAX_ALERTS = 500;

export type LatestPrice = { minCopper: number; day: string };

export type AlertStatus = {
  id: number;
  marketId: number;
  itemKey: string;
  direction: AlertDirection;
  thresholdCopper: number;
  /** Dernier prix pris en compte ; null sans relevé depuis le début de l'historique. */
  latest: LatestPrice | null;
  triggered: boolean;
};

/** Prix pris en compte : un relevé antérieur au début de l'historique (bêta) ne compte pas. */
export function consideredPrice(latest: LatestPrice | null, historyFrom: string | null): LatestPrice | null {
  return latest && (historyFrom === null || latest.day >= historyFrom) ? latest : null;
}

/** Un seuil bas se déclenche au prix égal ou inférieur, un seuil haut au prix égal ou supérieur. */
export function isTriggered(direction: AlertDirection, thresholdCopper: number, latest: LatestPrice | null): boolean {
  if (!latest) return false;
  return direction === "below" ? latest.minCopper <= thresholdCopper : latest.minCopper >= thresholdCopper;
}

/** Alertes d'un marché (ou de tous), d'un objet au besoin, avec le dernier prix relevé. Déclenchées en tête. */
export async function listAlerts(db: Database, options: { marketId?: number; itemKey?: string; historyFrom?: string | null } = {}): Promise<AlertStatus[]> {
  const historyFrom = options.historyFrom === undefined ? historyStart(await readSettings(db)) : options.historyFrom;
  const filters = [
    options.marketId === undefined ? undefined : eq(t.priceAlerts.marketId, options.marketId),
    options.itemKey === undefined ? undefined : eq(t.priceAlerts.itemKey, options.itemKey),
  ].filter((filter) => filter !== undefined);
  const rows = await db
    .select({
      id: t.priceAlerts.id,
      marketId: t.priceAlerts.marketId,
      itemKey: t.priceAlerts.itemKey,
      direction: t.priceAlerts.direction,
      thresholdCopper: t.priceAlerts.thresholdCopper,
      minCopper: t.marketItemLatest.minCopper,
      day: t.marketItemLatest.day,
    })
    .from(t.priceAlerts)
    .leftJoin(t.marketItemLatest, and(eq(t.marketItemLatest.marketId, t.priceAlerts.marketId), eq(t.marketItemLatest.itemKey, t.priceAlerts.itemKey)))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(t.priceAlerts.itemKey), asc(t.priceAlerts.direction));

  return rows
    .map((row) => {
      const direction = row.direction as AlertDirection;
      const latest = consideredPrice(row.minCopper === null || row.day === null ? null : { minCopper: row.minCopper, day: row.day }, historyFrom);
      return {
        id: row.id,
        marketId: row.marketId,
        itemKey: row.itemKey,
        direction,
        thresholdCopper: row.thresholdCopper,
        latest,
        triggered: isTriggered(direction, row.thresholdCopper, latest),
      };
    })
    .sort((a, b) => Number(b.triggered) - Number(a.triggered));
}

export type SaveAlertsResult = { ok: true; saved: number; removed: number } | { ok: false; error: string };

/**
 * Seuils d'un objet sur un marché : chaque seuil donné est posé ou remplacé, chaque seuil null
 * est retiré. Un seuil bas doit rester sous le seuil haut, sinon l'alerte serait toujours déclenchée.
 */
export async function saveItemAlerts(
  db: Database,
  input: { marketId: number; itemKey: string; below: number | null; above: number | null; now: Date },
): Promise<SaveAlertsResult> {
  if (!ITEM_KEY_PATTERN.test(input.itemKey)) return { ok: false, error: "Objet inconnu." };
  if (input.below !== null && input.above !== null && input.below >= input.above) {
    return { ok: false, error: "Le seuil bas doit être inférieur au seuil haut." };
  }
  return db.transaction(async (tx) => {
    const [market] = await tx.select({ id: t.markets.id }).from(t.markets).where(eq(t.markets.id, input.marketId));
    if (!market) return { ok: false, error: "Marché introuvable." };

    const thresholds: [AlertDirection, number | null][] = [
      ["below", input.below],
      ["above", input.above],
    ];
    const ofItem = and(eq(t.priceAlerts.marketId, input.marketId), eq(t.priceAlerts.itemKey, input.itemKey));
    const [{ total, mine }] = await tx
      .select({ total: sql<number>`count(*)::int`, mine: sql<number>`(count(*) filter (where ${ofItem}))::int` })
      .from(t.priceAlerts);
    const added = thresholds.filter(([, value]) => value !== null).length - mine;
    if (added > 0 && total + added > MAX_ALERTS) return { ok: false, error: `${MAX_ALERTS} alertes au plus : retirez-en d'abord.` };

    let saved = 0;
    let removed = 0;
    for (const [direction, value] of thresholds) {
      const where = and(ofItem, eq(t.priceAlerts.direction, direction));
      if (value === null) {
        removed += (await tx.delete(t.priceAlerts).where(where).returning({ id: t.priceAlerts.id })).length;
        continue;
      }
      await tx
        .insert(t.priceAlerts)
        .values({ marketId: input.marketId, itemKey: input.itemKey, direction, thresholdCopper: value, createdAt: input.now, updatedAt: input.now })
        .onConflictDoUpdate({
          target: [t.priceAlerts.marketId, t.priceAlerts.itemKey, t.priceAlerts.direction],
          set: { thresholdCopper: value, updatedAt: input.now },
        });
      saved++;
    }
    return { ok: true, saved, removed };
  });
}

/** Retire une alerte ; renvoie l'objet et le marché qu'elle visait, null si elle n'existait plus. */
export async function deleteAlert(db: Database, id: number): Promise<{ marketId: number; itemKey: string } | null> {
  const [row] = await db.delete(t.priceAlerts).where(eq(t.priceAlerts.id, id)).returning({ marketId: t.priceAlerts.marketId, itemKey: t.priceAlerts.itemKey });
  return row ?? null;
}
