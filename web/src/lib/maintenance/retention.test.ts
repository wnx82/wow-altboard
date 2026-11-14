import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { OPPORTUNITY_RUNS_KEPT, pruneHistory } from "./retention";

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
    assert.deepEqual(await pruneHistory(database.db, NOW), { syncRuns: 0, opportunityRuns: 0 });
  });
});
