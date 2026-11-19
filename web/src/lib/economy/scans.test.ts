import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { change24h, listScanMarkets, loadItemScanSeries, scanMarketLabel, scanSeriesWithin, type ScanPoint } from "./scans";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/ezauctioneer-account.json"), "utf8"),
);
const NOW = new Date("2026-11-19T12:00:00Z");
const OLD_SCAN = new Date(1794915321 * 1000);
const LAST_SCAN = new Date(1795079141 * 1000);
const HOUR = 3_600_000;

const point = (hoursAgo: number, price: number): ScanPoint => ({ at: new Date(NOW.getTime() - hoursAgo * HOUR), price, units: 1 });

describe("variation sur 24 h", () => {
  test("face au dernier scan d'au moins 24 h plus tôt", () => {
    assert.equal(change24h([point(30, 100), point(25, 200), point(1, 150)]), -0.25);
  });

  test("sans scan assez ancien, ou trop ancien : pas de variation", () => {
    assert.equal(change24h([]), null);
    assert.equal(change24h([point(10, 100), point(1, 150)]), null);
    assert.equal(change24h([point(60, 100), point(1, 150)]), null);
  });
});

test("libellé d'un marché", () => {
  assert.equal(scanMarketLabel({ house: "faction", faction: "Horde", realm: "R" }), "HV de faction Horde · R");
  assert.equal(scanMarketLabel({ house: "neutral", faction: null, realm: "R" }), "HV neutre · R");
});

describe("lecture des scans", () => {
  let database: TestDatabase;

  before(async () => {
    database = await openTestDatabase();
  });

  after(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.reset();
    const { id } = await createAgentToken(database.db, "PC de test");
    await processSync(database.db, structuredClone(BASE), { tokenId: id, requestId: "test", now: NOW });
  });

  test("taille de chaque marché au dernier scan qui l'a donnée", async () => {
    const [market] = await listScanMarkets(database.db, { flavor: "_forever_", now: NOW });

    assert.equal(market.label, "HV de faction Alliance · Royaume Test PvE");
    assert.deepEqual(market.lastScanAt, LAST_SCAN);
    assert.deepEqual(market.lastSized, { at: LAST_SCAN, auctions: 174284, listedItems: 6744, origin: "own" });
    assert.equal(market.scans7d, 3);
    assert.deepEqual(await listScanMarkets(database.db, { flavor: "_classic_", now: NOW }), []);
    // Une semaine plus tard, plus aucun scan dans les 7 derniers jours.
    assert.equal((await listScanMarkets(database.db, { now: new Date(NOW.getTime() + 8 * 24 * HOUR) }))[0].scans7d, 0);
  });

  test("prix d'un objet scan par scan, variation sur 24 h", async () => {
    const [series] = await loadItemScanSeries(database.db, { itemId: 2589, flavor: "_forever_", since: null, now: NOW });

    assert.deepEqual(
      series.points.map((p) => [p.at.getTime() / 1000, p.price, p.units]),
      [
        [1794915321, 10, 1200],
        [1795009157, 12, 840],
        [1795079141, 15, 610],
      ],
    );
    assert.deepEqual(series.latest, { at: LAST_SCAN, price: 15, units: 610 });
    // Dernier scan d'au moins 24 h plus tôt : celui du 17 novembre, à 10 cuivres.
    assert.equal(series.change24h, 0.5);
    assert.equal(series.variants, 0);
    assert.deepEqual(series.days, []);
  });

  test("début de l'historique et période", async () => {
    const [series] = await loadItemScanSeries(database.db, { itemId: 2589, flavor: "_forever_", since: new Date(OLD_SCAN.getTime() + 1_000), now: NOW });
    assert.equal(series.points.length, 2);

    const within = scanSeriesWithin(series, new Date(LAST_SCAN.getTime() - HOUR));
    assert.equal(within.points.length, 1);
  });

  test("objet à suffixe : variante signalée, sans courbe ; objet inconnu : rien", async () => {
    const [boots] = await loadItemScanSeries(database.db, { itemId: 4306, flavor: "_forever_", since: null, now: NOW });

    assert.deepEqual([boots.points.length, boots.variants, boots.latest], [0, 1, null]);
    assert.deepEqual(await loadItemScanSeries(database.db, { itemId: 999, flavor: "_forever_", since: null, now: NOW }), []);
  });

  test("jours résumés repris pour un objet", async () => {
    const [{ id }] = await database.db.select({ id: t.scanMarkets.id }).from(t.scanMarkets);
    await database.db.insert(t.marketItemScanDays).values({
      scanMarketId: id,
      itemKey: "i:2589",
      itemId: 2589,
      day: "2026-09-10",
      lowCopper: 8,
      medianCopper: 9,
      highCopper: 11,
      maxUnits: 900,
      scans: 4,
    });

    const [series] = await loadItemScanSeries(database.db, { itemId: 2589, flavor: "_forever_", since: null, now: NOW });

    assert.deepEqual(series.days, [{ day: "2026-09-10", low: 8, median: 9, high: 11, maxUnits: 900, scans: 4 }]);
    assert.deepEqual(scanSeriesWithin(series, new Date("2026-10-01T00:00:00Z")).days, []);
  });
});
