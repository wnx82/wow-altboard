import { and, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { chunks, uniqueBy } from "./helpers";
import type { EconomyCounters } from "./economy";
import { type AccountPayload, SCAN_ITEM_KEY_PATTERN, SCAN_MARKET_KEY_PATTERN, type ScanMarketPayload } from "./schema";

// Import des scans d'EZAuctioneer d'un compte (voir docs/EZAUCTIONEER-DATA-MODEL.md). L'addon ne
// garde que les derniers scans de chaque objet : le serveur les accumule, scan après scan, sans
// doublon. Rien n'est calculé ici, hors les comptes par scan.

type Scope = { accountId: number; machineId: number; runId: number; now: Date };

const BATCH = 2_000;

/**
 * Écart toléré entre l'heure d'un rapport de scan et celle de ses relevés : l'addon date les deux
 * séparément, à une seconde près sur les fichiers réels.
 */
export const REPORT_MATCH_SECONDS = 120;

/** Région, royaume et maison (HV de faction et sa faction, ou HV neutre) tirés de la clé du marché. */
export function parseScanMarketKey(key: string): { region: string; realm: string; house: "faction" | "neutral"; faction: string | null } | null {
  const match = SCAN_MARKET_KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, region, realm, faction] = match;
  return faction === undefined ? { region, realm, house: "neutral", faction: null } : { region, realm, house: "faction", faction };
}

/** Objet d'une clé d'EZAuctioneer (« i:1234 », « i:1234:s5 »). */
export function scanItemId(key: string): number | null {
  const match = SCAN_ITEM_KEY_PATTERN.exec(key);
  return match ? Number(match[1]) : null;
}

export async function applyEzAuctioneer(tx: DatabaseOrTransaction, account: AccountPayload, scope: Scope, counters: EconomyCounters): Promise<void> {
  const payload = account.ezAuctioneer;
  if (!payload) return;
  for (const market of payload.markets) await applyScanMarket(tx, account.flavor, market, payload.file, scope, counters);
}

async function applyScanMarket(
  tx: DatabaseOrTransaction,
  flavor: string,
  market: ScanMarketPayload,
  file: { hash: string; modifiedAt: string },
  scope: Scope,
  counters: EconomyCounters,
): Promise<void> {
  // Le schéma de l'API a déjà vérifié la forme de la clé.
  const parts = parseScanMarketKey(market.key)!;
  const [row] = await tx
    .insert(t.scanMarkets)
    .values({ flavor, marketKey: market.key, ...parts, firstSeenAt: scope.now, lastSeenAt: scope.now })
    .onConflictDoUpdate({ target: [t.scanMarkets.flavor, t.scanMarkets.marketKey], set: { lastSeenAt: scope.now } })
    .returning({ id: t.scanMarkets.id });
  const scanMarketId = row.id;

  // Même contenu déjà reçu de ce compte (envoi répété, autre PC au fichier identique) : rien à refaire.
  const [known] = await tx
    .select({ id: t.scanImports.id })
    .from(t.scanImports)
    .where(and(eq(t.scanImports.scanMarketId, scanMarketId), eq(t.scanImports.accountId, scope.accountId), eq(t.scanImports.contentHash, market.contentHash)));
  if (known) {
    counters.scanMarketsUnchanged++;
    return;
  }

  const samples = uniqueBy(
    market.items.flatMap((item) =>
      item.samples.map(([at, price, units]) => ({
        scanMarketId,
        itemKey: item.key,
        itemId: scanItemId(item.key)!,
        scannedAt: new Date(at * 1000),
        priceCopper: price,
        units,
      })),
    ),
    (sample) => `${sample.itemKey}|${sample.scannedAt.getTime()}`,
  );
  const times = [...new Set(samples.map((sample) => sample.scannedAt.getTime()))].sort((a, b) => a - b);

  await tx.insert(t.scanImports).values({
    scanMarketId,
    accountId: scope.accountId,
    machineId: scope.machineId,
    syncRunId: scope.runId,
    contentHash: market.contentHash,
    fileHash: file.hash,
    fileModifiedAt: new Date(file.modifiedAt),
    itemsCount: market.items.length,
    samplesCount: samples.length,
    firstScanAt: times.length > 0 ? new Date(times[0]) : null,
    lastScanAt: times.length > 0 ? new Date(times.at(-1)!) : null,
    receivedAt: scope.now,
  });

  // Un relevé déjà reçu (même objet, même scan) ne change plus : c'est la photo d'un instant.
  let inserted = 0;
  for (const batch of chunks(samples, BATCH)) {
    const result = await tx.insert(t.marketItemScans).values(batch).onConflictDoNothing();
    inserted += result.rowCount ?? 0;
  }

  // Un scan par heure de relevé ; ses comptes sont recalculés sur tout ce qui est en base.
  const scanTimes = times.map((time) => new Date(time));
  if (scanTimes.length > 0) {
    for (const batch of chunks(scanTimes, BATCH)) {
      await tx.execute(sql`
        insert into ${t.marketScans} (scan_market_id, scanned_at, sampled_items, units, updated_at)
        select ${scanMarketId}::bigint, scanned_at, count(*)::int, coalesce(sum(units), 0)::bigint, ${scope.now}::timestamptz
        from ${t.marketItemScans}
        where ${eq(t.marketItemScans.scanMarketId, scanMarketId)} and ${inArray(t.marketItemScans.scannedAt, batch)}
        group by scanned_at
        on conflict (scan_market_id, scanned_at) do update
          set sampled_items = excluded.sampled_items, units = excluded.units, updated_at = excluded.updated_at
          where (${t.marketScans.sampledItems}, ${t.marketScans.units}) is distinct from (excluded.sampled_items, excluded.units)
      `);
    }
  }

  // Rapports de l'addon : rattachés au scan de relevés le plus proche, sinon scan sans relevé
  // (analysé sans entrer dans l'historique de l'addon, par exemple trop proche du précédent).
  for (const report of uniqueBy(market.scans, (scan) => scan.at)) {
    const reportAt = report.at * 1000;
    const nearest = times.reduce<number | null>(
      (best, time) => (Math.abs(time - reportAt) <= REPORT_MATCH_SECONDS * 1000 && (best === null || Math.abs(time - reportAt) < Math.abs(best - reportAt)) ? time : best),
      null,
    );
    const scannedAt = new Date(nearest ?? reportAt);
    await tx
      .insert(t.marketScans)
      .values({
        scanMarketId,
        scannedAt,
        auctions: report.auctions ?? null,
        listedItems: report.items ?? null,
        origin: report.origin ?? null,
        updatedAt: scope.now,
      })
      .onConflictDoUpdate({
        target: [t.marketScans.scanMarketId, t.marketScans.scannedAt],
        set: {
          auctions: sql`coalesce(excluded.auctions, ${t.marketScans.auctions})`,
          listedItems: sql`coalesce(excluded.listed_items, ${t.marketScans.listedItems})`,
          origin: sql`coalesce(excluded.origin, ${t.marketScans.origin})`,
          updatedAt: scope.now,
        },
        setWhere: sql`(coalesce(excluded.auctions, ${t.marketScans.auctions}), coalesce(excluded.listed_items, ${t.marketScans.listedItems}), coalesce(excluded.origin, ${t.marketScans.origin})) is distinct from (${t.marketScans.auctions}, ${t.marketScans.listedItems}, ${t.marketScans.origin})`,
      });
  }

  counters.scanMarketsImported++;
  counters.scanSamples += inserted;
}

