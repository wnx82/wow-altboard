import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { deleteAccount } from "@/lib/dashboard/delete-account";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { processSync } from "./process";
import { parseScanMarketKey, scanItemId } from "./scans";
import type { ScanMarketPayload, SyncPayload } from "./schema";

// Document produit par l'agent 0.10.0 à partir des fixtures account-four-characters.lua et
// ezauctioneer-small.lua (voir tests/fixtures/README.md).
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/ezauctioneer-account.json"), "utf8"),
);
const NOW = new Date("2026-11-19T12:00:00Z");
const OTHER_ACCOUNT = "b".repeat(64);
// Heures des scans de la fixture (secondes Unix, heure du serveur du jeu).
const OLD_SCAN = 1794915321;
const MIDDLE_SCAN = 1795009157;
const LAST_SCAN = 1795079141;

let database: TestDatabase;
let tokenId: number;
let token: string;

const clone = (): SyncPayload => structuredClone(BASE);
const market = (payload: SyncPayload): ScanMarketPayload => payload.accounts[0].ezAuctioneer!.markets[0];
const samples = (payload: SyncPayload) => market(payload).items.reduce((total, item) => total + item.samples.length, 0);
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
    markets: await count(t.scanMarkets),
    imports: await count(t.scanImports),
    scans: await count(t.marketScans),
    samples: await count(t.marketItemScans),
  };
}

async function scans() {
  return (await database.db.select().from(t.marketScans).orderBy(asc(t.marketScans.scannedAt))).map((row) => ({
    at: row.scannedAt.getTime() / 1000,
    auctions: row.auctions,
    listedItems: row.listedItems,
    origin: row.origin,
    sampledItems: row.sampledItems,
    units: row.units,
  }));
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

describe("clés d'EZAuctioneer", () => {
  test("marché de faction, marché neutre, clé inconnue", () => {
    assert.deepEqual(parseScanMarketKey("3:CAMWOW EU5 Realm 5 PvE:Alliance:faction"), {
      region: "3",
      realm: "CAMWOW EU5 Realm 5 PvE",
      house: "faction",
      faction: "Alliance",
    });
    assert.deepEqual(parseScanMarketKey("3:Royaume:neutral"), { region: "3", realm: "Royaume", house: "neutral", faction: null });
    assert.equal(parseScanMarketKey("PvE"), null);
  });

  test("objet d'une clé, avec ou sans suffixe", () => {
    assert.equal(scanItemId("i:2589"), 2589);
    assert.equal(scanItemId("i:4306:s1019"), 4306);
    assert.equal(scanItemId("i:4306:s-12:f300"), 4306);
    assert.equal(scanItemId("2589"), null);
  });
});

describe("scans EZAuctioneer", () => {
  test("le document de l'agent est accepté et importé tel quel", async () => {
    const response = await post(clone());
    const json = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200, JSON.stringify(json));
    assert.deepEqual([json.scanMarketsImported, json.scanMarketsUnchanged, json.scanSamples], [1, 0, samples(BASE)]);
    assert.deepEqual(await totals(), { markets: 1, imports: 1, scans: 3, samples: 5 });

    const [row] = await database.db.select().from(t.scanMarkets);
    assert.deepEqual([row.flavor, row.region, row.realm, row.house, row.faction], ["_forever_", "3", "Royaume Test PvE", "faction", "Alliance"]);
    const [boots] = await database.db.select().from(t.marketItemScans).where(eq(t.marketItemScans.itemKey, "i:4306:s1019"));
    assert.deepEqual([boots.itemId, boots.priceCopper, boots.units, boots.scannedAt.getTime() / 1000], [4306, 24750, 2, LAST_SCAN]);

    // Le rapport du scan du milieu, daté une seconde après ses relevés, s'y rattache.
    assert.deepEqual(await scans(), [
      { at: OLD_SCAN, auctions: null, listedItems: null, origin: null, sampledItems: 1, units: 1200 },
      { at: MIDDLE_SCAN, auctions: 241312, listedItems: 5981, origin: "external", sampledItems: 1, units: 840 },
      { at: LAST_SCAN, auctions: 174284, listedItems: 6744, origin: "own", sampledItems: 3, units: 613 },
    ]);
    const [imported] = await database.db.select().from(t.scanImports);
    assert.deepEqual(
      [imported.itemsCount, imported.samplesCount, imported.firstScanAt?.getTime(), imported.lastScanAt?.getTime()],
      [3, 5, OLD_SCAN * 1000, LAST_SCAN * 1000],
    );
  });

  test("le même fichier envoyé dix fois ne crée aucun doublon", async () => {
    await sync(clone());
    const first = await totals();

    for (let i = 0; i < 10; i++) {
      const result = await sync(clone(), new Date(NOW.getTime() + (i + 1) * 60_000));
      assert.deepEqual([result.scanMarketsImported, result.scanMarketsUnchanged, result.scanSamples], [0, 1, 0]);
    }

    assert.deepEqual(await totals(), first);
  });

  test("les scans s'accumulent quand l'addon oublie les plus anciens", async () => {
    await sync(clone());
    const next = clone();
    const m = market(next);
    m.contentHash = "c".repeat(64);
    const newer = LAST_SCAN + 3_600;
    // L'addon a perdu le plus ancien relevé du lin et ajouté le scan suivant.
    m.items = [{ key: "i:2589", samples: [[MIDDLE_SCAN, 12, 840], [LAST_SCAN, 15, 610], [newer, 14, 700]] }];
    m.scans = [{ at: newer, auctions: 180_000, items: 6_800, origin: "own" }];

    const result = await sync(next);

    assert.deepEqual([result.scanMarketsImported, result.scanSamples], [1, 1]);
    assert.deepEqual(await totals(), { markets: 1, imports: 2, scans: 4, samples: 6 });
    const last = (await scans()).at(-1)!;
    assert.deepEqual(last, { at: newer, auctions: 180_000, listedItems: 6_800, origin: "own", sampledItems: 1, units: 700 });
    // Le scan déjà connu garde ses comptes : ses trois relevés sont toujours là.
    assert.equal((await scans()).find((scan) => scan.at === LAST_SCAN)?.sampledItems, 3);
  });

  test("deux comptes du même marché : un relevé, pas deux", async () => {
    await sync(clone());
    const other = clone();
    const a = other.accounts[0];
    a.accountKey = OTHER_ACCOUNT;
    delete a.folderName;
    a.characters = [];
    market(other).contentHash = "d".repeat(64);

    const result = await sync(other);

    assert.deepEqual([result.scanMarketsImported, result.scanSamples], [1, 0]);
    assert.deepEqual(await totals(), { markets: 1, imports: 2, scans: 3, samples: 5 });
  });

  test("un autre client a ses propres marchés", async () => {
    await sync(clone());
    const beta = clone();
    beta.accounts[0].flavor = "_classic_beta_";
    beta.accounts[0].accountKey = OTHER_ACCOUNT;
    delete beta.accounts[0].folderName;
    beta.accounts[0].characters = [];

    await sync(beta);

    assert.equal(await count(t.scanMarkets), 2);
    assert.equal(await count(t.marketItemScans), 10);
  });

  test("une clé de marché ou d'objet inconnue fait refuser le document", async () => {
    const badMarket = clone();
    market(badMarket).key = "PvE";
    const badItem = clone();
    market(badItem).items[0].key = "2589";
    const badPrice = clone();
    market(badPrice).items[0].samples[0][1] = 0;

    for (const payload of [badMarket, badItem, badPrice]) {
      const response = await post(payload);
      assert.equal(response.status, 422);
      assert.equal(((await response.json()) as { code: string }).code, "invalid_payload");
    }
    assert.equal(await count(t.scanMarkets), 0);
  });

  test("un scan daté dans le futur fait refuser le document", async () => {
    const future = clone();
    const later = Math.floor(NOW.getTime() / 1000) + 2 * 3_600;
    market(future).items[0].samples.push([later, 5, 1]);

    const response = await post(future);
    const json = (await response.json()) as { code: string; issues: { path: string }[] };

    assert.equal(response.status, 422);
    assert.equal(json.code, "future_timestamp");
    assert.deepEqual(
      json.issues.map((issue) => issue.path),
      [`accounts.0.ezAuctioneer.markets.0.items.0.samples.${market(future).items[0].samples.length - 1}.0`],
    );
  });

  test("supprimer le compte retire ses imports, pas les relevés", async () => {
    await sync(clone());
    const [{ id }] = await database.db.select({ id: t.wowAccounts.id }).from(t.wowAccounts);

    assert.ok(await deleteAccount(database.db, id));

    assert.deepEqual(await totals(), { markets: 1, imports: 0, scans: 3, samples: 5 });
  });

  test("un document sans bloc EZAuctioneer ne touche à rien", async () => {
    const without = clone();
    delete without.accounts[0].ezAuctioneer;

    const result = await sync(without);

    assert.deepEqual([result.scanMarketsImported, result.scanMarketsUnchanged, result.scanSamples], [0, 0, 0]);
    assert.deepEqual(await totals(), { markets: 0, imports: 0, scans: 0, samples: 0 });
  });
});
