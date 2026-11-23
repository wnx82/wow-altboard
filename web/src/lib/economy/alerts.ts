import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { readSettings } from "@/lib/settings/store";
import { freshestLatest, linkedIds, loadScanLatest, scanLinks } from "./feeds";
import { historyStart } from "./load";
import { ITEM_KEY_PATTERN } from "./view";

// Alertes de prix : un seuil bas (« prévenir sous 12 po ») et un seuil haut par objet et par marché,
// comparés au dernier prix relevé : champ m d'Auctionator (table market_item_latest), ou dernier scan
// d'EZAuctioneer d'un marché relié quand il est plus récent (feeds.ts). Le résultat se relit à chaque
// affichage (fiche de l'objet, Marché, accueil). Seule l'annonce d'un franchissement au webhook des
// notifications est retenue (notified_at, noticeAlerts) : une fois par franchissement.

export const ALERT_DIRECTIONS = ["below", "above"] as const;
export type AlertDirection = (typeof ALERT_DIRECTIONS)[number];

/** Au-delà, une nouvelle alerte est refusée : la liste de la page Marché reste lisible. */
export const MAX_ALERTS = 500;

/** at et source : heure et addon du relevé, quand on les connaît. */
export type LatestPrice = { minCopper: number; day: string; at?: Date | null; source?: "auctionator" | "ezauctioneer" };

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
export async function listAlerts(
  db: Database,
  options: { marketId?: number; itemKey?: string; historyFrom?: string | null; now?: Date } = {},
): Promise<AlertStatus[]> {
  const now = options.now ?? new Date();
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
      observedAt: t.marketItemLatest.observedAt,
    })
    .from(t.priceAlerts)
    .leftJoin(t.marketItemLatest, and(eq(t.marketItemLatest.marketId, t.priceAlerts.marketId), eq(t.marketItemLatest.itemKey, t.priceAlerts.itemKey)))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(t.priceAlerts.itemKey), asc(t.priceAlerts.direction));

  // Dernier scan des marchés d'EZAuctioneer reliés à chaque marché alerté (60 jours de relevés gardés tels quels).
  const scanned = new Map<number, Map<string, { price: number; at: Date }>>();
  const marketIds = [...new Set(rows.map((row) => row.marketId))];
  if (marketIds.length > 0) {
    const markets = await db.select({ id: t.markets.id, flavor: t.markets.flavor, auctionKey: t.markets.auctionKey }).from(t.markets).where(inArray(t.markets.id, marketIds));
    const since = new Date(now.getTime() - 60 * 24 * 60 * 60_000);
    await Promise.all(
      markets.map(async (market) => {
        const ids = linkedIds(await scanLinks(db, market, now));
        const keys = rows.filter((row) => row.marketId === market.id).map((row) => row.itemKey);
        scanned.set(market.id, await loadScanLatest(db, ids, since, keys));
      }),
    );
  }

  return rows
    .map((row) => {
      const direction = row.direction as AlertDirection;
      const auction = row.minCopper === null || row.day === null || row.observedAt === null ? null : { minCopper: row.minCopper, day: row.day, observedAt: row.observedAt };
      const latest = consideredPrice(freshestLatest(auction, scanned.get(row.marketId)?.get(row.itemKey) ?? null), historyFrom);
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
  const result = await db.transaction(async (tx): Promise<SaveAlertsResult> => {
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
  if (!result.ok) return result;
  // Un seuil déjà franchi au moment où il est posé se voit sur la page : il n'est pas annoncé.
  await noticeAlerts(db, await listAlerts(db, { marketId: input.marketId, itemKey: input.itemKey, now: input.now }), input.now);
  return result;
}

/**
 * Retient les franchissements : une alerte déclenchée et encore armée est datée (notified_at) et
 * renvoyée, pour être annoncée ; une alerte qui ne l'est plus est réarmée. Les statuts viennent de
 * listAlerts ; seule la mise à jour conditionnelle décide, deux passages n'annoncent donc pas deux fois.
 */
export async function noticeAlerts(db: DatabaseOrTransaction, statuses: readonly AlertStatus[], now: Date): Promise<AlertStatus[]> {
  const triggered = statuses.filter((alert) => alert.triggered).map((alert) => alert.id);
  const calm = statuses.filter((alert) => !alert.triggered).map((alert) => alert.id);
  const [fresh] = await Promise.all([
    triggered.length === 0
      ? []
      : db
          .update(t.priceAlerts)
          .set({ notifiedAt: now })
          .where(and(inArray(t.priceAlerts.id, triggered), isNull(t.priceAlerts.notifiedAt)))
          .returning({ id: t.priceAlerts.id }),
    calm.length === 0
      ? []
      : db
          .update(t.priceAlerts)
          .set({ notifiedAt: null })
          .where(and(inArray(t.priceAlerts.id, calm), isNotNull(t.priceAlerts.notifiedAt))),
  ]);
  const ids = new Set(fresh.map((row) => row.id));
  return statuses.filter((alert) => ids.has(alert.id));
}

/** Retire une alerte ; renvoie l'objet et le marché qu'elle visait, null si elle n'existait plus. */
export async function deleteAlert(db: Database, id: number): Promise<{ marketId: number; itemKey: string } | null> {
  const [row] = await db.delete(t.priceAlerts).where(eq(t.priceAlerts.id, id)).returning({ marketId: t.priceAlerts.marketId, itemKey: t.priceAlerts.itemKey });
  return row ?? null;
}
