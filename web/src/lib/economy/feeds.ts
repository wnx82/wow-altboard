import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { cachedEconomy } from "./cache";
import { addDays, todayInBrussels } from "./days";
import type { DayObservation, LatestObservation } from "./prices";
import { scanMarketLabel } from "./scans";

// Prix du moteur : les relevés journaliers d'Auctionator, complétés par les scans d'EZAuctioneer
// du même hôtel des ventes (voir docs/ECONOMY-ENGINE.md, « Scans EZAuctioneer »).
//
// Un marché d'EZAuctioneer n'est relié à un marché d'Auctionator que si les deux sont compatibles
// (même client, même faction quand la clé d'Auctionator en nomme une) ET si leurs prix concordent
// sur les objets relevés les mêmes jours : les libellés des royaumes ne suffisent pas (« Realm 5 »
// et « Realm 1 » pour un même hôtel des ventes). Seuls les objets simples (« i:1234 ») sont repris ;
// les variantes à suffixe aléatoire n'ont pas d'équivalent chez Auctionator.

export type PriceSource = "auctionator" | "ezauctioneer";

/** Jours comparés pour vérifier qu'un marché d'EZAuctioneer est bien le même hôtel des ventes. */
export const LINK_DAYS = 14;
/** Objets-jours communs au moins : en dessous, la concordance n'est pas établie. */
export const LINK_MIN_PAIRS = 30;
/** Rapport médian des prix (EZAuctioneer ÷ Auctionator) admis : entre 0,9 et 1,1. */
export const LINK_MAX_RATIO_GAP = 0.1;
/** Part des objets-jours à moins de 5 % d'écart, au moins. */
export const LINK_MIN_AGREEMENT = 0.4;

export type ScanLink = {
  scanMarketId: number;
  label: string;
  /** Objets-jours relevés par les deux sur la période comparée. */
  pairs: number;
  /** Médiane du rapport des plus bas du jour (EZAuctioneer ÷ Auctionator). */
  medianRatio: number | null;
  /** Part des objets-jours à moins de 5 % d'écart. */
  agreement: number | null;
  linked: boolean;
  /** Pourquoi le marché est écarté ; null s'il est relié. */
  reason: string | null;
};

type AuctionMarket = { id: number; flavor: string; auctionKey: string };
type ScanMarket = { id: number; flavor: string; realm: string; house: string; faction: string | null };

/** Faction nommée par la clé d'Auctionator (« PvE Alliance ») ; null si elle n'en nomme aucune (« PvE »). */
export function auctionFaction(auctionKey: string): "Alliance" | "Horde" | "Neutral" | null {
  const match = /\b(Alliance|Horde|Neutral)$/i.exec(auctionKey.trim());
  if (!match) return null;
  const word = match[1].toLowerCase();
  return word === "alliance" ? "Alliance" : word === "horde" ? "Horde" : "Neutral";
}

/** Même client et, quand la clé d'Auctionator nomme une faction, même maison et même faction. */
export function compatible(market: Pick<AuctionMarket, "flavor" | "auctionKey">, scan: Pick<ScanMarket, "flavor" | "house" | "faction">): boolean {
  if (market.flavor !== scan.flavor) return false;
  const faction = auctionFaction(market.auctionKey);
  if (faction === null) return true;
  if (faction === "Neutral") return scan.house === "neutral";
  return scan.house === "faction" && scan.faction === faction;
}

/** Verdict sur la concordance des prix de deux marchés. */
export function judgeLink(stats: { pairs: number; medianRatio: number | null; agreement: number | null }): string | null {
  if (stats.pairs < LINK_MIN_PAIRS) return `moins de ${LINK_MIN_PAIRS} objets relevés les mêmes jours sur ${LINK_DAYS} jours`;
  if (stats.medianRatio === null || Math.abs(stats.medianRatio - 1) > LINK_MAX_RATIO_GAP) return "prix trop différents";
  if (stats.agreement === null || stats.agreement < LINK_MIN_AGREEMENT) return "prix trop rarement concordants";
  return null;
}

/** Clé d'Auctionator d'un objet d'EZAuctioneer : « 1234 » pour « i:1234 » ; null pour une variante ou un autre type. */
export function auctionItemKey(scanKey: string): string | null {
  return /^i:[1-9]\d{0,9}$/.test(scanKey) ? scanKey.slice(2) : null;
}

/** Clé d'EZAuctioneer d'un objet d'Auctionator : « i:1234 » pour « 1234 » ; null pour « g:… » ou « p:… ». */
export function scanItemKey(itemKey: string): string | null {
  return /^[1-9]\d{0,9}$/.test(itemKey) ? `i:${itemKey}` : null;
}

/** Jours fusionnés : par jour, le plus bas des plus bas, le plus haut des plus hauts, la plus grande quantité. */
export function mergeDays(base: readonly DayObservation[], extra: readonly DayObservation[]): DayObservation[] {
  if (extra.length === 0) return [...base];
  const byDay = new Map<string, DayObservation>();
  for (const day of [...base, ...extra]) {
    const known = byDay.get(day.day);
    byDay.set(
      day.day,
      known
        ? {
            day: day.day,
            low: Math.min(known.low, day.low),
            high: Math.max(known.high, day.high),
            available: known.available === null ? day.available : day.available === null ? known.available : Math.max(known.available, day.available),
          }
        : { ...day },
    );
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Dernier prix d'Auctionator : le jour du scan, l'heure du fichier qui l'a fourni. */
export type AuctionLatest = { minCopper: number; day: string; observedAt: Date };
/** Dernier relevé d'EZAuctioneer : 25e percentile pondéré par les unités, à l'heure du scan. */
export type ScanLatest = { price: number; at: Date };

/** Le plus récent des deux derniers prix ; à égalité, celui d'Auctionator. */
export function freshestLatest(auction: AuctionLatest | null, scan: ScanLatest | null): LatestObservation | null {
  if (scan && (!auction || scan.at.getTime() > auction.observedAt.getTime())) {
    return { minCopper: scan.price, day: todayInBrussels(scan.at), at: scan.at, source: "ezauctioneer" };
  }
  return auction ? { minCopper: auction.minCopper, day: auction.day, at: auction.observedAt, source: "auctionator" } : null;
}

/** Concordance de chaque marché d'EZAuctioneer compatible avec un marché d'Auctionator. */
async function measureLinks(db: Database, market: AuctionMarket, now: Date): Promise<ScanLink[]> {
  const candidates = (await db.select().from(t.scanMarkets).where(eq(t.scanMarkets.flavor, market.flavor))).filter((scan) => compatible(market, scan));
  if (candidates.length === 0) return [];
  const since = new Date(now.getTime() - LINK_DAYS * 24 * 60 * 60_000);
  const result = await db.execute<{ scan_market_id: string; pairs: number; median_ratio: number | null; agreement: number | null }>(sql`
    with scans as (
      select ${t.marketItemScans.scanMarketId} as scan_market_id,
             substr(${t.marketItemScans.itemKey}, 3) as item_key,
             (${t.marketItemScans.scannedAt} at time zone 'Europe/Brussels')::date as day,
             min(${t.marketItemScans.priceCopper}) as low
      from ${t.marketItemScans}
      where ${inArray(t.marketItemScans.scanMarketId, candidates.map((scan) => scan.id))}
        and ${t.marketItemScans.scannedAt} >= ${since}
        and ${t.marketItemScans.itemKey} ~ '^i:[1-9][0-9]*$'
      group by 1, 2, 3
    )
    select s.scan_market_id::text as scan_market_id,
           count(*)::int as pairs,
           percentile_cont(0.5) within group (order by s.low::float8 / d.low_copper) as median_ratio,
           avg(case when abs(s.low::float8 / d.low_copper - 1) <= 0.05 then 1.0 else 0.0 end)::float8 as agreement
    from scans s
    join ${t.marketItemDays} d on d.market_id = ${market.id} and d.item_key = s.item_key and d.day = s.day
    where d.low_copper > 0
    group by s.scan_market_id
  `);
  const measured = new Map(result.rows.map((row) => [Number(row.scan_market_id), row]));
  return candidates
    .map((scan) => {
      const row = measured.get(scan.id);
      const stats = { pairs: row?.pairs ?? 0, medianRatio: row?.median_ratio ?? null, agreement: row?.agreement ?? null };
      const reason = judgeLink(stats);
      return { scanMarketId: scan.id, label: scanMarketLabel(scan), ...stats, linked: reason === null, reason };
    })
    .sort((a, b) => Number(b.linked) - Number(a.linked) || b.pairs - a.pairs);
}

/**
 * Marchés d'EZAuctioneer comparés à un marché d'Auctionator, reliés d'abord. Gardé en mémoire
 * jusqu'au prochain import (Auctionator ou EZAuctioneer) ou au jour suivant.
 */
export async function scanLinks(db: Database, market: AuctionMarket, now: Date): Promise<ScanLink[]> {
  const basis = await db.execute<{ scans: string | null; imports: string | null }>(sql`
    select (select max(id) from ${t.scanImports})::text as scans, (select max(id) from ${t.marketImports})::text as imports
  `);
  const { scans, imports } = basis.rows[0];
  const key = JSON.stringify(["scan-links", market.id, todayInBrussels(now), scans, imports]);
  return cachedEconomy(key, () => measureLinks(db, market, now));
}

export const linkedIds = (links: readonly ScanLink[]) => links.filter((link) => link.linked).map((link) => link.scanMarketId);

/**
 * Relevés d'EZAuctioneer ramenés à un jour de Bruxelles (plus bas, plus haut, plus grande quantité),
 * en clés d'Auctionator, depuis `from` (AAAA-MM-JJ). itemKeys : seulement ces objets.
 */
export async function loadScanDays(db: Database, scanMarketIds: readonly number[], from: string, itemKeys?: readonly string[]): Promise<Map<string, DayObservation[]>> {
  const days = new Map<string, DayObservation[]>();
  if (scanMarketIds.length === 0) return days;
  const keys = itemKeys?.flatMap((key) => scanItemKey(key) ?? []);
  if (keys && keys.length === 0) return days;
  const since = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const [raw, folded] = await Promise.all([
    db
      .select({
        itemKey: t.marketItemScans.itemKey,
        day: sql<string>`(${t.marketItemScans.scannedAt} at time zone 'Europe/Brussels')::date::text`,
        low: sql<number>`min(${t.marketItemScans.priceCopper})::bigint`,
        high: sql<number>`max(${t.marketItemScans.priceCopper})::bigint`,
        available: sql<number>`max(${t.marketItemScans.units})::int`,
      })
      .from(t.marketItemScans)
      .where(
        and(
          inArray(t.marketItemScans.scanMarketId, [...scanMarketIds]),
          gte(t.marketItemScans.scannedAt, since),
          keys ? inArray(t.marketItemScans.itemKey, keys) : sql`${t.marketItemScans.itemKey} ~ '^i:[1-9][0-9]*$'`,
        ),
      )
      .groupBy(t.marketItemScans.itemKey, sql`2`),
    db
      .select({
        itemKey: t.marketItemScanDays.itemKey,
        day: t.marketItemScanDays.day,
        low: t.marketItemScanDays.lowCopper,
        high: t.marketItemScanDays.highCopper,
        available: t.marketItemScanDays.maxUnits,
      })
      .from(t.marketItemScanDays)
      .where(
        and(
          inArray(t.marketItemScanDays.scanMarketId, [...scanMarketIds]),
          gte(t.marketItemScanDays.day, from),
          keys ? inArray(t.marketItemScanDays.itemKey, keys) : sql`${t.marketItemScanDays.itemKey} ~ '^i:[1-9][0-9]*$'`,
        ),
      ),
  ]);
  const grouped = new Map<string, DayObservation[]>();
  for (const row of [...raw, ...folded]) {
    const itemKey = auctionItemKey(row.itemKey);
    if (itemKey === null || row.day < from) continue;
    const list = grouped.get(itemKey) ?? [];
    list.push({ day: row.day, low: Number(row.low), high: Number(row.high), available: row.available });
    grouped.set(itemKey, list);
  }
  // Plusieurs marchés reliés, ou un jour à la fois résumé et relevé : un seul relevé par jour.
  for (const [itemKey, list] of grouped) days.set(itemKey, mergeDays([], list));
  return days;
}

/** Dernier relevé d'EZAuctioneer de chaque objet depuis `since`, en clés d'Auctionator. */
export async function loadScanLatest(db: Database, scanMarketIds: readonly number[], since: Date, itemKeys?: readonly string[]): Promise<Map<string, ScanLatest>> {
  const latest = new Map<string, ScanLatest>();
  if (scanMarketIds.length === 0) return latest;
  const keys = itemKeys?.flatMap((key) => scanItemKey(key) ?? []);
  if (keys && keys.length === 0) return latest;
  const rows = await db
    .selectDistinctOn([t.marketItemScans.itemKey], { itemKey: t.marketItemScans.itemKey, price: t.marketItemScans.priceCopper, at: t.marketItemScans.scannedAt })
    .from(t.marketItemScans)
    .where(
      and(
        inArray(t.marketItemScans.scanMarketId, [...scanMarketIds]),
        gte(t.marketItemScans.scannedAt, since),
        keys ? inArray(t.marketItemScans.itemKey, keys) : sql`${t.marketItemScans.itemKey} ~ '^i:[1-9][0-9]*$'`,
      ),
    )
    .orderBy(t.marketItemScans.itemKey, sql`${t.marketItemScans.scannedAt} desc`);
  for (const row of rows) {
    const itemKey = auctionItemKey(row.itemKey);
    if (itemKey !== null) latest.set(itemKey, { price: row.price, at: row.at });
  }
  return latest;
}
