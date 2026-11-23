import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { foldOldScans, OPPORTUNITY_RUNS_KEPT, pruneHistory } from "./retention";

const NOW = new Date("2026-11-14T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);

let database: TestDatabase;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

async function machine(name: string): Promise<number> {
  const [row] = await database.db.insert(t.machines).values({ machineUuid: crypto.randomUUID(), hostname: name }).returning({ id: t.machines.id });
  return row.id;
}

async function run(machineId: number, startedAt: Date, status: "success" | "failed" = "success"): Promise<number> {
  const [row] = await database.db.insert(t.syncRuns).values({ machineId, requestId: "test", startedAt, status }).returning({ id: t.syncRuns.id });
  return row.id;
}

describe("durée de conservation", () => {
  test("journal des synchronisations : 180 jours, la dernière de chaque PC reste", async () => {
    const busy = await machine("PC-ACTIF");
    const silent = await machine("PC-MUET");
    const old = await run(busy, daysAgo(400));
    const recent = await run(busy, daysAgo(10));
    await database.db.insert(t.syncErrors).values({ syncRunId: old, code: "test", message: "ancienne erreur" });
    // PC muet depuis un an : sa dernière synchronisation réussie et sa dernière tentative restent.
    // Insérées dans l'ordre du temps, comme le serveur les écrit.
    const olderSuccess = await run(silent, daysAgo(390));
    const lastSuccess = await run(silent, daysAgo(380));
    const lastFailure = await run(silent, daysAgo(370), "failed");
    // Relevé lié à une synchronisation purgée : gardé, sans le lien.
    const [account] = await database.db.insert(t.wowAccounts).values({ accountKey: "compte-de-test" }).returning({ id: t.wowAccounts.id });
    const [realm] = await database.db.insert(t.realms).values({ name: "Royaume" }).returning({ id: t.realms.id });
    const [character] = await database.db
      .insert(t.characters)
      .values({ guid: "Player-1-00000001", name: "Test", accountId: account.id, realmId: realm.id, sourceLastSeenAt: daysAgo(400), contentHash: "x", firstSeenAt: daysAgo(400), lastSyncAt: daysAgo(400) })
      .returning({ id: t.characters.id });
    await database.db.insert(t.characterSnapshots).values({ characterId: character.id, capturedAt: daysAgo(400), syncRunId: old, snapshotHash: "h", data: {} });

    const result = await pruneHistory(database.db, NOW);

    const left = (await database.db.select({ id: t.syncRuns.id }).from(t.syncRuns).orderBy(asc(t.syncRuns.id))).map((row) => row.id);
    assert.deepEqual(left, [recent, lastSuccess, lastFailure].sort((a, b) => a - b));
    assert.equal(result.syncRuns, 2);
    assert.ok(!left.includes(olderSuccess));
    assert.equal(await countRows(database.db, t.syncErrors), 0);
    const [snapshot] = await database.db.select({ syncRunId: t.characterSnapshots.syncRunId }).from(t.characterSnapshots);
    assert.equal(snapshot.syncRunId, null);
  });

  test("calculs d'opportunités : les 30 derniers par marché, et ceux d'un audit du jour", async () => {
    const [market] = await database.db.insert(t.markets).values({ flavor: "_forever_", auctionKey: "PvE", firstSeenAt: NOW, lastSeenAt: NOW }).returning({ id: t.markets.id });
    const ids: number[] = [];
    for (let index = 0; index < OPPORTUNITY_RUNS_KEPT + 5; index++) {
      const [row] = await database.db
        .insert(t.opportunityRuns)
        .values({ marketId: market.id, computedAt: daysAgo(40 - index), engineVersion: "1", parameters: {}, opportunitiesCount: 1 })
        .returning({ id: t.opportunityRuns.id });
      await database.db.insert(t.opportunities).values({ runId: row.id, rank: 1, kind: "SELL", confidence: 80, horizon: "now", reasonCodes: [], inputs: {} });
      ids.push(row.id);
    }
    await database.db.insert(t.economyAudits).values({ marketId: market.id, day: "2026-10-05", runId: ids[1], model: "test", text: "audit", writtenAt: NOW });

    const result = await pruneHistory(database.db, NOW);

    const left = (await database.db.select({ id: t.opportunityRuns.id }).from(t.opportunityRuns).orderBy(asc(t.opportunityRuns.id))).map((row) => row.id);
    assert.deepEqual(left, [ids[1], ...ids.slice(5)]);
    assert.equal(result.opportunityRuns, 4);
    assert.equal(await countRows(database.db, t.opportunities), OPPORTUNITY_RUNS_KEPT + 1);
  });

  test("rien à purger : aucune ligne touchée", async () => {
    const pc = await machine("PC");
    await run(pc, daysAgo(1));
    assert.deepEqual(await pruneHistory(database.db, NOW), { syncRuns: 0, opportunityRuns: 0, scanSamplesFolded: 0, checklistChecks: 0 });
  });
});

describe("scans EZAuctioneer au-delà de 60 jours", () => {
  async function scanMarket(): Promise<number> {
    const [row] = await database.db
      .insert(t.scanMarkets)
      .values({ flavor: "_forever_", marketKey: "3:R:Alliance:faction", region: "3", realm: "R", house: "faction", faction: "Alliance" })
      .returning({ id: t.scanMarkets.id });
    return row.id;
  }

  const sample = (scanMarketId: number, at: string, priceCopper: number, units: number) => ({
    scanMarketId,
    itemKey: "i:2589",
    itemId: 2589,
    scannedAt: new Date(at),
    priceCopper,
    units,
  });

  const days = async () =>
    (await database.db.select().from(t.marketItemScanDays).orderBy(asc(t.marketItemScanDays.day))).map((d) => [d.day, d.lowCopper, d.medianCopper, d.highCopper, d.maxUnits, d.scans]);

  test("jours entiers (heure de Bruxelles) résumés puis supprimés, les 60 derniers gardés", async () => {
    const id = await scanMarket();
    await database.db.insert(t.marketItemScans).values([
      sample(id, "2026-09-10T08:00:00Z", 100, 5),
      sample(id, "2026-09-10T14:00:00Z", 300, 9),
      sample(id, "2026-09-10T20:00:00Z", 200, 7),
      // 00:30 à Bruxelles : jour suivant.
      sample(id, "2026-09-10T22:30:00Z", 50, 1),
      // Dernière minute du dernier jour résumé, puis premier instant gardé (minuit à Bruxelles, il y a 60 jours).
      sample(id, "2026-09-14T21:59:00Z", 70, 2),
      sample(id, "2026-09-14T22:00:00Z", 80, 3),
      sample(id, "2026-11-13T10:00:00Z", 90, 4),
    ]);

    assert.equal(await foldOldScans(database.db, NOW), 5);

    assert.deepEqual(await days(), [
      ["2026-09-10", 100, 200, 300, 9, 3],
      ["2026-09-11", 50, 50, 50, 1, 1],
      ["2026-09-14", 70, 70, 70, 2, 1],
    ]);
    const kept = await database.db.select({ at: t.marketItemScans.scannedAt }).from(t.marketItemScans).orderBy(asc(t.marketItemScans.scannedAt));
    assert.deepEqual(kept.map((row) => row.at.toISOString()), ["2026-09-14T22:00:00.000Z", "2026-11-13T10:00:00.000Z"]);
    assert.equal(await foldOldScans(database.db, NOW), 0);
  });

  test("un relevé arrivé après le résumé de son jour s'y ajoute", async () => {
    const id = await scanMarket();
    await database.db.insert(t.marketItemScans).values([sample(id, "2026-09-10T08:00:00Z", 100, 5), sample(id, "2026-09-10T14:00:00Z", 300, 9), sample(id, "2026-09-10T20:00:00Z", 200, 7)]);
    await foldOldScans(database.db, NOW);
    await database.db.insert(t.marketItemScans).values(sample(id, "2026-09-10T10:00:00Z", 400, 20));

    const result = await pruneHistory(database.db, NOW);

    assert.equal(result.scanSamplesFolded, 1);
    // Bornes et comptes exacts ; la médiane reste celle de la partie la mieux relevée.
    assert.deepEqual(await days(), [["2026-09-10", 100, 200, 400, 20, 4]]);
    assert.equal(await countRows(database.db, t.marketItemScans), 0);
    const [row] = await database.db.select().from(t.marketItemScanDays).where(eq(t.marketItemScanDays.scanMarketId, id));
    assert.equal(row.itemId, 2589);
  });
});
