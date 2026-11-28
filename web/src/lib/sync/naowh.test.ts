import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { and, asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { deleteAccount } from "@/lib/dashboard/delete-account";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { parseNaowhHouseKey } from "./naowh";
import { processSync } from "./process";
import { type SyncPayload, syncPayloadSchema } from "./schema";

// Document produit par l'agent 0.12.0 à partir des fixtures account-four-characters.lua,
// naowh-market-small.lua et naowh-feed-small.lua (voir tests/fixtures/README.md).
const BASE: SyncPayload = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/naowh-account.json"), "utf8"));
const NOW = new Date("2026-11-28T12:00:00Z");
const HOUSE = "Royaume Fictif-Alliance";
// Heures de la fixture (secondes Unix, heure du serveur du jeu).
const SCANNED = 1795817357;
const SEEN = 1795820000;
const RECORDED = 1795839703;

let database: TestDatabase;
let tokenId: number;
let token: string;

const clone = (): SyncPayload => structuredClone(BASE);
const house = (payload: SyncPayload) => payload.accounts[0].naowhMarket!.houses.find((h) => h.key === HOUSE)!;
const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);
const sync = (payload: SyncPayload, now = NOW) => processSync(database.db, payload, { tokenId, requestId: "test", now });
const post = (payload: unknown) =>
  handleSyncRequest(
    new Request("https://wow.example.test/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    }),
    { db: database.db, rateLimiter: new RateLimiter(), now: () => NOW, log: () => {} },
  );

async function totals() {
  return {
    houses: await count(t.naowhHouses),
    imports: await count(t.naowhImports),
    prices: await count(t.naowhPrices),
    days: await count(t.naowhPriceDays),
    feedHouses: await count(t.naowhFeedHouses),
    feedPrices: await count(t.naowhFeedPrices),
  };
}

async function price(itemId: number) {
  const [houseRow] = await database.db.select().from(t.naowhHouses).where(eq(t.naowhHouses.houseKey, HOUSE));
  const [row] = await database.db
    .select()
    .from(t.naowhPrices)
    .where(and(eq(t.naowhPrices.houseId, houseRow.id), eq(t.naowhPrices.itemId, itemId)));
  return row && { low: row.lowCopper, listed: row.listed, pricedAt: row.pricedAt?.getTime() ?? null, median: row.medianCopper, medianAt: row.medianAt?.getTime() ?? null };
}

async function day(itemId: number, date: string) {
  const [houseRow] = await database.db.select().from(t.naowhHouses).where(eq(t.naowhHouses.houseKey, HOUSE));
  const [row] = await database.db
    .select()
    .from(t.naowhPriceDays)
    .where(and(eq(t.naowhPriceDays.houseId, houseRow.id), eq(t.naowhPriceDays.itemId, itemId), eq(t.naowhPriceDays.day, date)));
  return row && { median: row.medianCopper, listed: row.listed };
}

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  const created = await createAgentToken(database.db, "PC de test");
  token = created.token;
  tokenId = created.id;
});

describe("clés de NaowhForever", () => {
  test("royaume et camp, royaume inconnu donné par le numéro du serveur", () => {
    assert.deepEqual(parseNaowhHouseKey("CAMWOW EU5 Realm 5 PvE-Alliance"), { realm: "CAMWOW EU5 Realm 5 PvE", side: "Alliance" });
    assert.deepEqual(parseNaowhHouseKey("6947-Blackwater"), { realm: "6947", side: "Blackwater" });
    assert.deepEqual(parseNaowhHouseKey("Royaume-Tiret-Horde"), { realm: "Royaume-Tiret", side: "Horde" });
    assert.equal(parseNaowhHouseKey("Royaume-Neutral"), null);
  });
});

describe("prix NaowhForever", () => {
  test("le document de l'agent est accepté et importé tel quel", async () => {
    const response = await post(clone());
    const json = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200, JSON.stringify(json));
    assert.deepEqual([json.naowhHousesImported, json.naowhHousesUnchanged, json.naowhFeedHousesImported], [2, 0, 3]);
    assert.deepEqual(await totals(), { houses: 2, imports: 2, prices: 26, days: 7, feedHouses: 3, feedPrices: 52 });

    const houses = await database.db.select().from(t.naowhHouses).orderBy(asc(t.naowhHouses.houseKey));
    assert.deepEqual(
      houses.map((row) => [row.flavor, row.houseKey, row.realm, row.side]),
      [
        ["_forever_", "6947-Blackwater", "6947", "Blackwater"],
        ["_forever_", HOUSE, "Royaume Fictif", "Alliance"],
      ],
    );
    // Revu en parcourant l'hôtel des ventes : daté de ce moment ; sinon, du scan complet.
    assert.deepEqual(await price(101), { low: 101_000, listed: 4, pricedAt: SEEN * 1000, median: 111_100, medianAt: SCANNED * 1000 });
    assert.deepEqual(await price(125), { low: 125_000, listed: 7, pricedAt: SCANNED * 1000, median: null, medianAt: null });
    assert.deepEqual(await price(127), { low: null, listed: null, pricedAt: null, median: 5_000, medianAt: SCANNED * 1000 });
    assert.deepEqual(await day(101, "2026-11-17"), { median: 1_000, listed: 3 });
    assert.deepEqual(await day(101, "2026-11-27"), { median: 1_050, listed: 4 });

    const feeds = await database.db.select().from(t.naowhFeedHouses).orderBy(asc(t.naowhFeedHouses.blizzardHouseId));
    assert.deepEqual(
      feeds.map((row) => [row.region, row.blizzardHouseId, row.faction, row.itemsCount, row.feedTime.getTime()]),
      [
        [3, 111, "Alliance", 25, RECORDED * 1000],
        [3, 114, "Horde", 25, RECORDED * 1000],
        [3, 117, "Blackwater", 2, RECORDED * 1000],
      ],
    );
    const [big] = await database.db.select().from(t.naowhFeedPrices).where(eq(t.naowhFeedPrices.itemId, 150));
    assert.deepEqual([big.lowCopper, big.medianCopper, big.listed], [1_000_000_000_000, 1_100_000_000_000, 2]);
  });

  test("le même fichier envoyé dix fois ne crée aucun doublon", async () => {
    await sync(clone());
    const first = await totals();

    for (let i = 0; i < 10; i++) {
      const result = await sync(clone(), new Date(NOW.getTime() + (i + 1) * 60_000));
      assert.deepEqual(
        [result.naowhHousesImported, result.naowhHousesUnchanged, result.naowhPrices, result.naowhDays, result.naowhFeedHousesImported, result.naowhFeedHousesUnchanged],
        [0, 2, 0, 0, 0, 3],
      );
    }

    assert.deepEqual(await totals(), first);
  });

  test("un scan plus récent remplace les prix, un fichier plus ancien ne les fait pas reculer", async () => {
    await sync(clone());

    const newer = clone();
    const fresh = house(newer);
    fresh.contentHash = "1".repeat(64);
    fresh.scannedAt = SCANNED + 3_600;
    fresh.medianAt = SCANNED + 3_600;
    fresh.items[0] = [101, 99_000, 100_000, 9, null];
    fresh.items[1] = [102, 98_000, null, 2, null];
    const result = await sync(newer, new Date(NOW.getTime() + 60_000));
    assert.equal(result.naowhHousesImported, 1);
    assert.deepEqual(await price(101), { low: 99_000, listed: 9, pricedAt: (SCANNED + 3_600) * 1000, median: 100_000, medianAt: (SCANNED + 3_600) * 1000 });
    // Sans médiane dans ce scan (page par page) : la médiane précédente reste, avec sa date.
    assert.deepEqual(await price(102), { low: 98_000, listed: 2, pricedAt: (SCANNED + 3_600) * 1000, median: 112_200, medianAt: SCANNED * 1000 });

    // Un autre PC envoie l'ancien fichier : rien ne recule.
    const older = clone();
    house(older).contentHash = "2".repeat(64);
    await sync(older, new Date(NOW.getTime() + 120_000));
    assert.equal((await price(101))!.low, 99_000);
    assert.equal((await price(102))!.median, 112_200);
  });

  test("le jour en cours suit l'historique le plus récent, les jours passés s'accumulent", async () => {
    await sync(clone());

    const later = clone();
    const next = house(later);
    next.contentHash = "3".repeat(64);
    next.recordedAt = RECORDED + 600;
    // L'addon a oublié le plus ancien jour et ajouté le suivant ; le jour en cours a changé.
    next.days = [
      next.days[1],
      { day: "2026-11-27", items: [[101, 1_070, 5]] },
      { day: "2026-11-28", items: [[101, 1_080, 6]] },
    ];
    await sync(later, new Date(NOW.getTime() + 60_000));
    assert.deepEqual(await day(101, "2026-11-17"), { median: 1_000, listed: 3 });
    assert.deepEqual(await day(101, "2026-11-27"), { median: 1_070, listed: 5 });
    assert.deepEqual(await day(101, "2026-11-28"), { median: 1_080, listed: 6 });

    // Un historique écrit plus tôt ne remplace pas le jour en cours.
    const stale = clone();
    house(stale).contentHash = "4".repeat(64);
    house(stale).recordedAt = RECORDED - 600;
    await sync(stale, new Date(NOW.getTime() + 120_000));
    assert.deepEqual(await day(101, "2026-11-27"), { median: 1_070, listed: 5 });
  });

  test("le flux n'est remplacé que par des données de Blizzard plus récentes", async () => {
    await sync(clone());

    const newer = clone();
    const feed = newer.naowhFeeds![0];
    feed.time = RECORDED + 7_200;
    feed.houses = [{ id: 117, faction: "Blackwater", items: [[101, 300, null, 1]] }];
    const result = await sync(newer, new Date(NOW.getTime() + 60_000));
    assert.deepEqual([result.naowhFeedHousesImported, result.naowhFeedHousesUnchanged], [1, 0]);
    const [blackwater] = await database.db.select().from(t.naowhFeedHouses).where(eq(t.naowhFeedHouses.blizzardHouseId, 117));
    const prices = await database.db.select().from(t.naowhFeedPrices).where(eq(t.naowhFeedPrices.feedHouseId, blackwater.id));
    assert.deepEqual(
      prices.map((row) => [row.itemId, row.lowCopper, row.medianCopper, row.listed]),
      [[101, 300, null, 1]],
    );
    // Les maisons absentes de cette version gardent la précédente.
    assert.equal((await totals()).feedPrices, 25 + 25 + 1);

    const replay = await sync(clone(), new Date(NOW.getTime() + 120_000));
    assert.deepEqual([replay.naowhFeedHousesImported, replay.naowhFeedHousesUnchanged], [0, 3]);
    const kept = await database.db.select().from(t.naowhFeedPrices).where(eq(t.naowhFeedPrices.feedHouseId, blackwater.id));
    assert.deepEqual(
      kept.map((row) => row.lowCopper),
      [300],
    );
  });

  test("supprimer le compte supprime ses imports, pas les prix déjà fusionnés", async () => {
    await sync(clone());
    const [account] = await database.db.select().from(t.wowAccounts);

    await deleteAccount(database.db, account.id);

    const after = await totals();
    assert.deepEqual([after.imports, after.prices, after.days, after.feedPrices], [0, 26, 7, 52]);
  });

  test("un document mal formé est refusé avant tout import", async () => {
    const unsorted = clone();
    const items = house(unsorted).items;
    [items[0], items[1]] = [items[1], items[0]];
    const noPrice = clone();
    house(noPrice).items[0] = [101, null, null, 4, null];
    const badHouse = clone();
    house(badHouse).key = "Royaume Fictif-Neutral";
    const badFeed = clone();
    badFeed.naowhFeeds![0].houses[0].faction = "Pirates" as "Alliance";

    for (const payload of [unsorted, noPrice, badHouse, badFeed]) {
      assert.equal(syncPayloadSchema.safeParse(payload).success, false);
      const response = await post(payload);
      assert.equal(response.status, 422);
    }
    assert.deepEqual(await totals(), { houses: 0, imports: 0, prices: 0, days: 0, feedHouses: 0, feedPrices: 0 });
  });

  test("une date de NaowhForever dans le futur fait refuser le document", async () => {
    const later = Math.floor(NOW.getTime() / 1000) + 2 * 3_600;
    const seen = clone();
    house(seen).items[1][4] = later;
    const day = clone();
    house(day).days.push({ day: "2026-11-30", items: [[101, 1_000, 1]] });
    const feed = clone();
    feed.naowhFeeds![0].time = later;

    const paths: string[][] = [];
    for (const payload of [seen, day, feed]) {
      const response = await post(payload);
      const json = (await response.json()) as { code: string; issues: { path: string }[] };
      assert.equal(response.status, 422);
      assert.equal(json.code, "future_timestamp");
      paths.push(json.issues.map((issue) => issue.path));
    }
    assert.deepEqual(paths, [
      ["accounts.0.naowhMarket.houses.1.items.1.4"],
      [`accounts.0.naowhMarket.houses.1.days.${house(day).days.length - 1}.day`],
      ["naowhFeeds.0.time"],
    ]);
    assert.equal((await totals()).houses, 0);
  });
});
