import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";

// Lecture des scans d'EZAuctioneer (voir docs/EZAUCTIONEER-DATA-MODEL.md) : taille de chaque
// marché et prix d'un objet scan par scan. Le moteur de prix les reprend par feeds.ts, pour les
// marchés dont les prix concordent avec ceux d'Auctionator.

export type ScanMarketSummary = {
  id: number;
  flavor: string;
  marketKey: string;
  realm: string;
  house: "faction" | "neutral";
  faction: string | null;
  label: string;
  /** Dernier scan reçu, avec ou sans rapport de l'addon. */
  lastScanAt: Date | null;
  /** Dernier scan dont l'addon a donné la taille. */
  lastSized: { at: Date; auctions: number | null; listedItems: number | null; origin: string | null } | null;
  scans7d: number;
};

export type ScanPoint = { at: Date; price: number; units: number };
export type ScanDay = { day: string; low: number; median: number; high: number; maxUnits: number; scans: number };
export type ItemScanSeries = {
  market: ScanMarketSummary;
  /** Relevés gardés tels quels (60 derniers jours), du plus ancien au plus récent. */
  points: ScanPoint[];
  /** Jours plus anciens, résumés. */
  days: ScanDay[];
  latest: ScanPoint | null;
  change24h: number | null;
  /** Variantes à suffixe aléatoire (« de l'Ours ») relevées à part, non comprises ici. */
  variants: number;
};

const DAY_MS = 24 * 60 * 60_000;

export function scanMarketLabel(market: { house: string; faction: string | null; realm: string }): string {
  return market.house === "neutral" ? `HV neutre · ${market.realm}` : `HV de faction ${market.faction ?? "?"} · ${market.realm}`;
}

/** Marchés relevés par EZAuctioneer, d'un client ou de tous, le plus récemment scanné d'abord. */
export async function listScanMarkets(db: Database, options: { flavor?: string; now: Date }): Promise<ScanMarketSummary[]> {
  const markets = await db
    .select()
    .from(t.scanMarkets)
    .where(options.flavor === undefined ? undefined : eq(t.scanMarkets.flavor, options.flavor));
  if (markets.length === 0) return [];
  const ids = markets.map((market) => market.id);
  const since = new Date(options.now.getTime() - 7 * DAY_MS);

  const [last, sized, recent] = await Promise.all([
    db
      .selectDistinctOn([t.marketScans.scanMarketId], { scanMarketId: t.marketScans.scanMarketId, at: t.marketScans.scannedAt })
      .from(t.marketScans)
      .where(inArray(t.marketScans.scanMarketId, ids))
      .orderBy(t.marketScans.scanMarketId, desc(t.marketScans.scannedAt)),
    db
      .selectDistinctOn([t.marketScans.scanMarketId], {
        scanMarketId: t.marketScans.scanMarketId,
        at: t.marketScans.scannedAt,
        auctions: t.marketScans.auctions,
        listedItems: t.marketScans.listedItems,
        origin: t.marketScans.origin,
      })
      .from(t.marketScans)
      .where(and(inArray(t.marketScans.scanMarketId, ids), isNotNull(t.marketScans.auctions)))
      .orderBy(t.marketScans.scanMarketId, desc(t.marketScans.scannedAt)),
    db
      .select({ scanMarketId: t.marketScans.scanMarketId, scans: count() })
      .from(t.marketScans)
      .where(and(inArray(t.marketScans.scanMarketId, ids), gte(t.marketScans.scannedAt, since)))
      .groupBy(t.marketScans.scanMarketId),
  ]);
  const lastOf = new Map(last.map((row) => [row.scanMarketId, row.at]));
  const sizedOf = new Map(sized.map(({ scanMarketId, ...row }) => [scanMarketId, row]));
  const recentOf = new Map(recent.map((row) => [row.scanMarketId, row.scans]));

  return markets
    .map((market) => ({
      id: market.id,
      flavor: market.flavor,
      marketKey: market.marketKey,
      realm: market.realm,
      house: market.house === "neutral" ? ("neutral" as const) : ("faction" as const),
      faction: market.faction,
      label: scanMarketLabel(market),
      lastScanAt: lastOf.get(market.id) ?? null,
      lastSized: sizedOf.get(market.id) ?? null,
      scans7d: recentOf.get(market.id) ?? 0,
    }))
    .sort((a, b) => (b.lastScanAt?.getTime() ?? 0) - (a.lastScanAt?.getTime() ?? 0) || a.id - b.id);
}

/**
 * Variation du dernier prix face au dernier relevé d'au moins 24 h plus tôt (et de moins de 48 h) :
 * null sans relevé assez proche de cet écart.
 */
export function change24h(points: readonly ScanPoint[]): number | null {
  const latest = points.at(-1);
  if (!latest) return null;
  const target = latest.at.getTime() - DAY_MS;
  const reference = points.findLast((point) => point.at.getTime() <= target);
  if (!reference || reference.at.getTime() < target - DAY_MS || reference.price <= 0) return null;
  return latest.price / reference.price - 1;
}

/**
 * Prix d'un objet scan par scan, sur chaque marché d'EZAuctioneer du client. L'objet est désigné
 * par son identifiant : la clé d'EZAuctioneer « i:1234 », sans suffixe aléatoire. since : début
 * de l'historique (relevés antérieurs ignorés), ou null.
 */
export async function loadItemScanSeries(db: Database, options: { itemId: number; flavor: string; since: Date | null; now: Date }): Promise<ItemScanSeries[]> {
  const markets = await listScanMarkets(db, { flavor: options.flavor, now: options.now });
  if (markets.length === 0) return [];
  const ids = markets.map((market) => market.id);
  const key = `i:${options.itemId}`;
  const sinceDay = options.since === null ? null : options.since.toISOString().slice(0, 10);

  const [points, days, variants] = await Promise.all([
    db
      .select({ scanMarketId: t.marketItemScans.scanMarketId, at: t.marketItemScans.scannedAt, price: t.marketItemScans.priceCopper, units: t.marketItemScans.units })
      .from(t.marketItemScans)
      .where(
        and(
          inArray(t.marketItemScans.scanMarketId, ids),
          eq(t.marketItemScans.itemKey, key),
          options.since === null ? undefined : gte(t.marketItemScans.scannedAt, options.since),
        ),
      )
      .orderBy(asc(t.marketItemScans.scannedAt)),
    db
      .select({
        scanMarketId: t.marketItemScanDays.scanMarketId,
        day: t.marketItemScanDays.day,
        low: t.marketItemScanDays.lowCopper,
        median: t.marketItemScanDays.medianCopper,
        high: t.marketItemScanDays.highCopper,
        maxUnits: t.marketItemScanDays.maxUnits,
        scans: t.marketItemScanDays.scans,
      })
      .from(t.marketItemScanDays)
      .where(
        and(
          inArray(t.marketItemScanDays.scanMarketId, ids),
          eq(t.marketItemScanDays.itemKey, key),
          sinceDay === null ? undefined : gte(t.marketItemScanDays.day, sinceDay),
        ),
      )
      .orderBy(asc(t.marketItemScanDays.day)),
    // « i:1234:… » : bornes de clé plutôt qu'un filtre sur item_id, pour rester sur la clé primaire.
    db
      .select({ scanMarketId: t.marketItemScans.scanMarketId, variants: sql<number>`count(distinct ${t.marketItemScans.itemKey})::int` })
      .from(t.marketItemScans)
      .where(and(inArray(t.marketItemScans.scanMarketId, ids), gte(t.marketItemScans.itemKey, `${key}:`), lt(t.marketItemScans.itemKey, `${key};`)))
      .groupBy(t.marketItemScans.scanMarketId),
  ]);

  return markets
    .map((market) => {
      const own = points.filter((point) => point.scanMarketId === market.id).map(({ at, price, units }) => ({ at, price, units }));
      return {
        market,
        points: own,
        days: days
          .filter((day) => day.scanMarketId === market.id)
          .map((day) => ({ day: day.day, low: day.low, median: day.median, high: day.high, maxUnits: day.maxUnits, scans: day.scans })),
        latest: own.at(-1) ?? null,
        change24h: change24h(own),
        variants: variants.find((row) => row.scanMarketId === market.id)?.variants ?? 0,
      };
    })
    .filter((series) => series.points.length > 0 || series.days.length > 0 || series.variants > 0);
}

/** Relevés et jours résumés de la période (from inclus), pour le graphique. */
export function scanSeriesWithin(series: ItemScanSeries, from: Date | null): { points: ScanPoint[]; days: ScanDay[] } {
  if (from === null) return { points: series.points, days: series.days };
  const fromDay = from.toISOString().slice(0, 10);
  return { points: series.points.filter((point) => point.at >= from), days: series.days.filter((day) => day.day >= fromDay) };
}
