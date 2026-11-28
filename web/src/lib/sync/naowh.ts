import { and, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import type { EconomyCounters } from "./economy";
import { chunks } from "./helpers";
import { type AccountPayload, NAOWH_HOUSE_KEY_PATTERN, type NaowhFeedPayload, type NaowhHousePayload } from "./schema";

// Import des prix de l'hôtel des ventes de NaowhForever (voir docs/NAOWH-MARKET-DATA-MODEL.md) :
// dernier scan et historique de chaque maison, envoyés par compte ; flux de prix livré avec l'addon,
// envoyé par client. L'addon ne garde que son dernier scan et 14 jours d'historique : le serveur
// garde le dernier prix connu et accumule les jours. Rien n'est calculé ici.

type Scope = { accountId: number; machineId: number; runId: number; now: Date };

const BATCH = 2_000;

/** Royaume et camp tirés de la clé d'une maison (« CAMWOW EU5 Realm 5 PvE-Alliance »). */
export function parseNaowhHouseKey(key: string): { realm: string; side: "Alliance" | "Horde" | "Blackwater" } | null {
  const match = NAOWH_HOUSE_KEY_PATTERN.exec(key);
  return match ? { realm: match[1], side: match[2] as "Alliance" | "Horde" | "Blackwater" } : null;
}

const instant = (seconds: number | null | undefined) => (seconds === null || seconds === undefined ? null : new Date(seconds * 1000));
const time = (date: Date | null) => date?.getTime() ?? null;

/**
 * Règle de remplacement d'un prix, la même que dans la requête : un prix reçu remplace le prix connu
 * si celui-ci manque ou n'est pas daté, ou si le relevé reçu est au moins aussi récent.
 */
function newer(value: number | null, at: Date | null, knownValue: number | null, knownAt: Date | null): boolean {
  if (value === null) return false;
  if (knownValue === null || knownAt === null) return true;
  return at !== null && at.getTime() >= knownAt.getTime();
}

export async function applyNaowhMarket(tx: DatabaseOrTransaction, account: AccountPayload, scope: Scope, counters: EconomyCounters): Promise<void> {
  const payload = account.naowhMarket;
  if (!payload) return;
  for (const house of payload.houses) await applyHouse(tx, account.flavor, house, payload.file, scope, counters);
}

async function applyHouse(
  tx: DatabaseOrTransaction,
  flavor: string,
  house: NaowhHousePayload,
  file: { hash: string; modifiedAt: string },
  scope: Scope,
  counters: EconomyCounters,
): Promise<void> {
  // Le schéma de l'API a déjà vérifié la forme de la clé.
  const parts = parseNaowhHouseKey(house.key)!;
  const [row] = await tx
    .insert(t.naowhHouses)
    .values({ flavor, houseKey: house.key, ...parts, firstSeenAt: scope.now, lastSeenAt: scope.now })
    .onConflictDoUpdate({ target: [t.naowhHouses.flavor, t.naowhHouses.houseKey], set: { lastSeenAt: scope.now } })
    .returning({ id: t.naowhHouses.id });
  const houseId = row.id;

  // Même contenu déjà reçu de ce compte (envoi répété, autre PC au fichier identique) : rien à refaire.
  const [known] = await tx
    .select({ id: t.naowhImports.id })
    .from(t.naowhImports)
    .where(and(eq(t.naowhImports.houseId, houseId), eq(t.naowhImports.accountId, scope.accountId), eq(t.naowhImports.contentHash, house.contentHash)));
  if (known) {
    counters.naowhHousesUnchanged++;
    return;
  }

  await tx.insert(t.naowhImports).values({
    houseId,
    accountId: scope.accountId,
    machineId: scope.machineId,
    syncRunId: scope.runId,
    contentHash: house.contentHash,
    fileHash: file.hash,
    fileModifiedAt: new Date(file.modifiedAt),
    scannedAt: instant(house.scannedAt),
    itemsCount: house.items.length,
    daysCount: house.days.length,
    receivedAt: scope.now,
  });

  // Le plus bas est daté du moment où l'objet a été revu, sinon du scan complet ; la médiane, du scan
  // rapide. Chacun n'est remplacé que par plus récent, ou s'il n'était pas daté.
  const scannedAt = instant(house.scannedAt);
  const medianAt = instant(house.medianAt);
  const received = house.items.map(([itemId, low, median, listed, seenAt]) => ({
    houseId,
    itemId,
    lowCopper: low,
    listed: low === null ? null : listed,
    pricedAt: low === null ? null : (instant(seenAt) ?? scannedAt),
    medianCopper: median,
    medianAt: median === null ? null : medianAt,
    updatedAt: scope.now,
  }));
  // Une maison change à chaque scan, mais la plupart de ses prix non : seules les lignes nouvelles ou
  // modifiées sont écrites (une écriture sans effet coûte presque autant qu'une vraie). La requête
  // garde la même règle, au cas où.
  const knownPrices = new Map(
    (await tx.select().from(t.naowhPrices).where(eq(t.naowhPrices.houseId, houseId))).map((row) => [row.itemId, row] as const),
  );
  const prices = received.filter((row) => {
    const known = knownPrices.get(row.itemId);
    if (!known) return true;
    const lowChanges =
      newer(row.lowCopper, row.pricedAt, known.lowCopper, known.pricedAt) &&
      (row.lowCopper !== known.lowCopper || row.listed !== known.listed || time(row.pricedAt) !== time(known.pricedAt));
    const medianChanges =
      newer(row.medianCopper, row.medianAt, known.medianCopper, known.medianAt) && (row.medianCopper !== known.medianCopper || time(row.medianAt) !== time(known.medianAt));
    return lowChanges || medianChanges;
  });
  const lowIsNewer = sql`excluded.low_copper is not null and (${t.naowhPrices.lowCopper} is null or ${t.naowhPrices.pricedAt} is null or excluded.priced_at >= ${t.naowhPrices.pricedAt})`;
  const medianIsNewer = sql`excluded.median_copper is not null and (${t.naowhPrices.medianCopper} is null or ${t.naowhPrices.medianAt} is null or excluded.median_at >= ${t.naowhPrices.medianAt})`;
  let changed = 0;
  for (const batch of chunks(prices, BATCH)) {
    const result = await tx
      .insert(t.naowhPrices)
      .values(batch)
      .onConflictDoUpdate({
        target: [t.naowhPrices.houseId, t.naowhPrices.itemId],
        set: {
          lowCopper: sql`case when ${lowIsNewer} then excluded.low_copper else ${t.naowhPrices.lowCopper} end`,
          listed: sql`case when ${lowIsNewer} then excluded.listed else ${t.naowhPrices.listed} end`,
          pricedAt: sql`case when ${lowIsNewer} then excluded.priced_at else ${t.naowhPrices.pricedAt} end`,
          medianCopper: sql`case when ${medianIsNewer} then excluded.median_copper else ${t.naowhPrices.medianCopper} end`,
          medianAt: sql`case when ${medianIsNewer} then excluded.median_at else ${t.naowhPrices.medianAt} end`,
          updatedAt: scope.now,
        },
        // Rien de plus récent, ou les mêmes valeurs : la ligne reste telle quelle.
        setWhere: sql`(${lowIsNewer} and (excluded.low_copper, excluded.listed, excluded.priced_at) is distinct from (${t.naowhPrices.lowCopper}, ${t.naowhPrices.listed}, ${t.naowhPrices.pricedAt}))
          or (${medianIsNewer} and (excluded.median_copper, excluded.median_at) is distinct from (${t.naowhPrices.medianCopper}, ${t.naowhPrices.medianAt}))`,
      });
    changed += result.rowCount ?? 0;
  }

  // Un jour d'historique n'est remplacé que par un historique écrit plus tard (ou non daté jusque-là).
  const recordedAt = instant(house.recordedAt);
  const knownDays = new Map<string, { medianCopper: number; listed: number | null; recordedAt: Date | null }>();
  if (house.days.length > 0) {
    const rows = await tx
      .select({ itemId: t.naowhPriceDays.itemId, day: t.naowhPriceDays.day, medianCopper: t.naowhPriceDays.medianCopper, listed: t.naowhPriceDays.listed, recordedAt: t.naowhPriceDays.recordedAt })
      .from(t.naowhPriceDays)
      .where(and(eq(t.naowhPriceDays.houseId, houseId), inArray(t.naowhPriceDays.day, house.days.map((day) => day.day))));
    for (const row of rows) knownDays.set(`${row.day}|${row.itemId}`, row);
  }
  const days = house.days
    .flatMap((day) => day.items.map(([itemId, median, listed]) => ({ houseId, itemId, day: day.day, medianCopper: median, listed, recordedAt, updatedAt: scope.now })))
    .filter((row) => {
      const known = knownDays.get(`${row.day}|${row.itemId}`);
      if (!known) return true;
      const later = known.recordedAt === null || (recordedAt !== null && recordedAt.getTime() >= known.recordedAt.getTime());
      return later && (row.medianCopper !== known.medianCopper || row.listed !== known.listed);
    });
  let dayRows = 0;
  for (const batch of chunks(days, BATCH)) {
    const result = await tx
      .insert(t.naowhPriceDays)
      .values(batch)
      .onConflictDoUpdate({
        target: [t.naowhPriceDays.houseId, t.naowhPriceDays.itemId, t.naowhPriceDays.day],
        set: { medianCopper: sql`excluded.median_copper`, listed: sql`excluded.listed`, recordedAt: sql`excluded.recorded_at`, updatedAt: scope.now },
        setWhere: sql`(${t.naowhPriceDays.recordedAt} is null or (excluded.recorded_at is not null and excluded.recorded_at >= ${t.naowhPriceDays.recordedAt}))
          and (excluded.median_copper, excluded.listed) is distinct from (${t.naowhPriceDays.medianCopper}, ${t.naowhPriceDays.listed})`,
      });
    dayRows += result.rowCount ?? 0;
  }

  counters.naowhHousesImported++;
  counters.naowhPrices += changed;
  counters.naowhDays += dayRows;
}

/**
 * Flux de prix de chaque client : une maison n'est remplacée que par une version plus récente des
 * données de Blizzard. Les maisons absentes d'une version (devenues vides) gardent leur dernière version.
 */
export async function applyNaowhFeeds(tx: DatabaseOrTransaction, feeds: readonly NaowhFeedPayload[], now: Date, counters: EconomyCounters): Promise<void> {
  for (const feed of feeds) {
    const feedTime = new Date(feed.time * 1000);
    for (const house of feed.houses) {
      const values = {
        flavor: feed.flavor,
        region: feed.region,
        blizzardHouseId: house.id,
        faction: house.faction,
        feedTime,
        fileHash: feed.file.hash,
        itemsCount: house.items.length,
        receivedAt: now,
      };
      const [row] = await tx
        .insert(t.naowhFeedHouses)
        .values(values)
        .onConflictDoUpdate({
          target: [t.naowhFeedHouses.flavor, t.naowhFeedHouses.region, t.naowhFeedHouses.blizzardHouseId],
          set: { faction: values.faction, feedTime, fileHash: values.fileHash, itemsCount: values.itemsCount, receivedAt: now },
          setWhere: sql`excluded.feed_time > ${t.naowhFeedHouses.feedTime}`,
        })
        .returning({ id: t.naowhFeedHouses.id });
      // Aucune ligne rendue : une version au moins aussi récente est déjà là.
      if (!row) {
        counters.naowhFeedHousesUnchanged++;
        continue;
      }

      await tx.delete(t.naowhFeedPrices).where(eq(t.naowhFeedPrices.feedHouseId, row.id));
      for (const batch of chunks(house.items, BATCH)) {
        await tx
          .insert(t.naowhFeedPrices)
          .values(batch.map(([itemId, low, median, listed]) => ({ feedHouseId: row.id, itemId, lowCopper: low, medianCopper: median, listed })));
      }
      counters.naowhFeedHousesImported++;
    }
  }
}
