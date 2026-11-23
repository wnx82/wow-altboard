import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, eq, gte } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { listAlerts, saveItemAlerts } from "./alerts";
import { invalidateEconomyCache } from "./cache";
import { addDays } from "./days";
import {
  auctionFaction,
  auctionItemKey,
  compatible,
  freshestLatest,
  judgeLink,
  LINK_DAYS,
  LINK_MIN_PAIRS,
  mergeDays,
  scanItemKey,
  scanLinks,
} from "./feeds";
import { loadEconomy, loadMarketValues } from "./load";

describe("flux de prix : règles", () => {
  test("faction d'une clé d'Auctionator", () => {
    assert.equal(auctionFaction("PvE"), null);
    assert.equal(auctionFaction("PvE Alliance"), "Alliance");
    assert.equal(auctionFaction("Valtharion Horde"), "Horde");
    assert.equal(auctionFaction("PvE Neutral"), "Neutral");
    assert.equal(auctionFaction("ClassicBetaPvE2"), null);
  });

  test("marchés compatibles : même client, même faction quand la clé en nomme une", () => {
    const alliance = { flavor: "_forever_", house: "faction", faction: "Alliance" };
    const neutral = { flavor: "_forever_", house: "neutral", faction: null };
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE" }, alliance), true);
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE" }, neutral), true);
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE Alliance" }, alliance), true);
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE Horde" }, alliance), false);
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE Alliance" }, neutral), false);
    assert.equal(compatible({ flavor: "_forever_", auctionKey: "PvE Neutral" }, neutral), true);
    assert.equal(compatible({ flavor: "_classic_beta_", auctionKey: "PvE" }, alliance), false);
  });

  test("concordance exigée : assez d'objets communs, rapport médian proche de 1, prix souvent égaux", () => {
    assert.equal(judgeLink({ pairs: LINK_MIN_PAIRS, medianRatio: 1.02, agreement: 0.7 }), null);
    assert.match(judgeLink({ pairs: LINK_MIN_PAIRS - 1, medianRatio: 1, agreement: 1 })!, /moins de 30 objets/);
    assert.equal(judgeLink({ pairs: 100, medianRatio: 1.2, agreement: 0.9 }), "prix trop différents");
    assert.equal(judgeLink({ pairs: 100, medianRatio: 1, agreement: 0.2 }), "prix trop rarement concordants");
  });

  test("clés d'objets : seuls les objets simples passent d'un addon à l'autre", () => {
    assert.equal(auctionItemKey("i:2589"), "2589");
    assert.equal(auctionItemKey("i:2589:1234"), null);
    assert.equal(auctionItemKey("p:39"), null);
    assert.equal(scanItemKey("2589"), "i:2589");
    assert.equal(scanItemKey("g:2589:60"), null);
    assert.equal(scanItemKey("p:39"), null);
  });

  test("jours fusionnés : plus bas des plus bas, plus haut des plus hauts, plus grande quantité", () => {
    const merged = mergeDays(
      [
        { day: "2026-11-02", low: 100, high: 150, available: 4 },
        { day: "2026-11-01", low: 90, high: 90, available: null },
      ],
      [
        { day: "2026-11-02", low: 95, high: 120, available: 9 },
        { day: "2026-11-03", low: 80, high: 85, available: 2 },
        { day: "2026-11-01", low: 99, high: 99, available: 3 },
      ],
    );
    assert.deepEqual(merged, [
      { day: "2026-11-01", low: 90, high: 99, available: 3 },
      { day: "2026-11-02", low: 95, high: 150, available: 9 },
      { day: "2026-11-03", low: 80, high: 85, available: 2 },
    ]);
  });

  test("dernier prix : le plus récent des deux, Auctionator à égalité", () => {
    const auction = { minCopper: 100, day: "2026-11-06", observedAt: new Date("2026-11-06T10:00:00Z") };
    assert.deepEqual(freshestLatest(auction, { price: 80, at: new Date("2026-11-06T23:30:00Z") }), {
      minCopper: 80,
      day: "2026-11-07",
      at: new Date("2026-11-06T23:30:00Z"),
      source: "ezauctioneer",
    });
    assert.equal(freshestLatest(auction, { price: 80, at: new Date("2026-11-06T10:00:00Z") })?.source, "auctionator");
    assert.equal(freshestLatest(null, null), null);
    assert.equal(freshestLatest(null, { price: 5, at: new Date("2026-11-01T12:00:00Z") })?.minCopper, 5);
  });
});

describe("flux de prix : moteur", () => {
  const BASE: SyncPayload = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
  );
  const NOW = new Date("2026-11-06T18:00:00Z");
  let database: TestDatabase;

  before(async () => {
    database = await openTestDatabase();
  });

  after(async () => {
    await database.close();
  });

  beforeEach(async () => {
    await database.reset();
    invalidateEconomyCache();
    const { id } = await createAgentToken(database.db, "PC de test");
    await processSync(database.db, structuredClone(BASE), { tokenId: id, requestId: "test", now: NOW });
  });

  async function scanMarket(realm: string, faction: string | null, flavor = "_forever_") {
    const [market] = await database.db
      .insert(t.scanMarkets)
      .values({
        flavor,
        marketKey: `3:${realm}:${faction ?? "Neutral"}:${faction ? "faction" : "neutral"}`,
        region: "3",
        realm,
        house: faction ? "faction" : "neutral",
        faction,
      })
      .returning({ id: t.scanMarkets.id });
    return market.id;
  }

  /** Un scan à midi (heure d'hiver de Bruxelles) de chaque objet-jour d'Auctionator des 14 derniers jours, prix × factor. */
  async function mirror(scanMarketId: number, factor: number) {
    const [auction] = await database.db.select({ id: t.markets.id }).from(t.markets);
    // La fixture ne relève que 15 objets-jours récents : vingt objets de plus sur deux jours.
    await database.db
      .insert(t.marketItemDays)
      .values(
        Array.from({ length: 20 }, (_, index) =>
          ["2026-11-05", "2026-11-06"].map((day) => ({ marketId: auction.id, itemKey: String(98_000 + index), day, lowCopper: 500 + index, highCopper: 600 + index, available: 4 })),
        ).flat(),
      )
      .onConflictDoNothing();
    const days = await database.db
      .select({ itemKey: t.marketItemDays.itemKey, day: t.marketItemDays.day, low: t.marketItemDays.lowCopper })
      .from(t.marketItemDays)
      .where(and(eq(t.marketItemDays.marketId, auction.id), gte(t.marketItemDays.day, addDays("2026-11-06", -(LINK_DAYS - 1)))));
    const rows = days
      .filter((row) => /^\d+$/.test(row.itemKey) && row.low > 0)
      .map((row) => ({
        scanMarketId,
        itemKey: `i:${row.itemKey}`,
        itemId: Number(row.itemKey),
        scannedAt: new Date(`${row.day}T11:00:00Z`),
        priceCopper: Math.max(1, Math.round(row.low * factor)),
        units: 3,
      }));
    await database.db.insert(t.marketItemScans).values(rows);
    return rows.length;
  }

  test("un marché d'EZAuctioneer aux prix concordants est relié ; un autre, écarté", async () => {
    const same = await scanMarket("Realm 5 PvE", "Alliance");
    const other = await scanMarket("Realm 1 PvE", "Alliance");
    const beta = await scanMarket("Realm 5 PvE", "Alliance", "_classic_beta_");
    const pairs = await mirror(same, 1);
    await mirror(other, 2);
    await mirror(beta, 1);
    assert.ok(pairs >= LINK_MIN_PAIRS, `la fixture donne ${pairs} objets-jours`);

    const [auction] = await database.db.select().from(t.markets);
    const links = await scanLinks(database.db, auction, NOW);
    assert.deepEqual(
      links.map((link) => [link.scanMarketId, link.linked, link.reason, link.pairs]),
      [
        [same, true, null, pairs],
        [other, false, "prix trop différents", pairs],
      ],
    );
    assert.equal(links[0].medianRatio, 1);
    assert.equal(links[0].agreement, 1);
    assert.equal(links[0].label, "HV de faction Alliance · Realm 5 PvE");
  });

  test("un scan plus récent qu'Auctionator donne le dernier prix ; ses jours complètent l'historique", async () => {
    const same = await scanMarket("Realm 5 PvE", "Alliance");
    await mirror(same, 1);
    await database.db.insert(t.marketItemScans).values([
      { scanMarketId: same, itemKey: "i:2576", itemId: 2576, scannedAt: new Date("2026-11-06T17:00:00Z"), priceCopper: 80, units: 5 },
      // Un objet qu'Auctionator ne relève pas : trois jours suffisent à lui donner une valeur.
      ...["2026-11-04", "2026-11-05", "2026-11-06"].map((day, index) => ({
        scanMarketId: same,
        itemKey: "i:99123",
        itemId: 99123,
        scannedAt: new Date(`${day}T09:00:00Z`),
        priceCopper: 1_000 + index * 100,
        units: 2,
      })),
      // Variante à suffixe : sans équivalent chez Auctionator, ignorée.
      { scanMarketId: same, itemKey: "i:99124:777", itemId: 99124, scannedAt: new Date("2026-11-06T09:00:00Z"), priceCopper: 5, units: 1 },
    ]);

    const context = (await loadEconomy(database.db, { now: NOW }))!;
    assert.deepEqual(context.scanLinks.map((link) => link.linked), [true]);
    const item = context.stats.get("2576")!;
    assert.deepEqual(item.current, { minCopper: 80, day: "2026-11-06", ageDays: 0, at: new Date("2026-11-06T17:00:00Z"), source: "ezauctioneer" });
    // Le plus bas du jour tient compte du scan.
    assert.equal(context.days.get("2576")!.at(-1)!.low, 80);
    const scannedOnly = context.stats.get("99123")!;
    assert.equal(scannedOnly.marketValue, 1_100);
    assert.equal(scannedOnly.current?.source, "ezauctioneer");
    assert.equal(context.stats.has("99124"), false);

    const values = await loadMarketValues(database.db, ["2576", "99123"], NOW);
    assert.equal(values.values.get("99123"), 1_100);

    // Le seuil est franchi par le scan, pas par le dernier prix d'Auctionator (100).
    await saveItemAlerts(database.db, { marketId: context.market.id, itemKey: "2576", below: 90, above: null, now: NOW });
    const [alert] = await listAlerts(database.db, { now: NOW });
    assert.equal(alert.triggered, true);
    assert.equal(alert.latest?.minCopper, 80);
    assert.equal(alert.latest?.source, "ezauctioneer");
  });

  test("sans marché relié, les prix restent ceux d'Auctionator", async () => {
    const other = await scanMarket("Realm 1 PvE", "Alliance");
    await mirror(other, 2);
    await database.db
      .insert(t.marketItemScans)
      .values({ scanMarketId: other, itemKey: "i:2576", itemId: 2576, scannedAt: new Date("2026-11-06T17:00:00Z"), priceCopper: 80, units: 5 });

    const context = (await loadEconomy(database.db, { now: NOW }))!;
    assert.deepEqual(context.scanLinks.map((link) => link.linked), [false]);
    assert.equal(context.stats.get("2576")!.current?.minCopper, 100);
    assert.equal(context.stats.get("2576")!.current?.source, "auctionator");
  });
});
