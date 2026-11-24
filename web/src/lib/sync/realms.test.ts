import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { processSync } from "./process";
import { fillRealms, guidServer, isRealmlessMarket, normalizeRealm, realmsByServer, withRealm } from "./realms";
import type { SyncPayload } from "./schema";

// Depuis le build 71037 de WoW Forever, le jeu ne donne plus le royaume : l'agent 0.11.1 transmet
// realm = "" et les clés de marché d'EZAuctioneer sans royaume.
const fixture = (name: string): SyncPayload =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../../tests/fixtures/payloads/${name}`), "utf8"));
const BASE = fixture("two-accounts.json");
const EZ = fixture("ezauctioneer-account.json");
const MAGE = "Player-9999-00000001";
const NOW = new Date("2026-11-24T12:00:00Z");
const NO_LOOKUPS = { byGuid: new Map(), byServer: new Map(), marketRealms: new Map() };

describe("royaume manquant : fonctions pures", () => {
  test("serveur d'un GUID de joueur", () => {
    assert.equal(guidServer("Player-6947-00000001"), "6947");
    assert.equal(guidServer("Player-4620-00000002"), "4620");
    assert.equal(guidServer("Creature-0-1"), null);
    assert.equal(guidServer("Player-6947"), null);
  });

  test("royaume normalisé, clé de marché sans royaume, royaume ajouté à une clé", () => {
    assert.equal(normalizeRealm("CAMWOW EU5 Realm 5 PvE"), "CAMWOWEU5Realm5PvE");
    assert.equal(normalizeRealm("Pyrewood-Village"), "PyrewoodVillage");
    assert.equal(isRealmlessMarket("3::Alliance:faction"), true);
    assert.equal(isRealmlessMarket("3::neutral"), true);
    assert.equal(isRealmlessMarket("3:Royaume:Alliance:faction"), false);
    assert.equal(isRealmlessMarket("pas une clé"), false);
    assert.equal(withRealm("3::Alliance:faction", "CAMWOW EU5 Realm 5 PvE"), "3:CAMWOW EU5 Realm 5 PvE:Alliance:faction");
    assert.equal(withRealm("?::neutral", "R"), "?:R:neutral");
  });

  test("royaume d'un serveur : le personnage le plus récemment vu l'emporte, un royaume vide ne compte pas", () => {
    const realms = realmsByServer([
      { guid: "Player-1-01", realm: "Ancien", lastSeen: 10 },
      { guid: "Player-1-02", realm: "Récent", lastSeen: 20 },
      { guid: "Player-1-03", realm: "", lastSeen: 30 },
      { guid: "Player-2-01", realm: "", lastSeen: 30 },
    ]);
    assert.deepEqual([...realms], [["1", "Récent"]]);
  });

  test("un document complet est rendu tel quel", () => {
    const payload = structuredClone(BASE);
    assert.equal(fillRealms(payload, NO_LOOKUPS), payload);
  });

  test("GUID connu, puis serveur du document, puis serveur en base ; sinon personnage écarté avec un avertissement", () => {
    const payload = structuredClone(BASE);
    const [mage, other] = payload.accounts[0].characters;
    mage.realm = "";
    other.realm = "";
    other.guid = "Player-9999-000000AA";
    payload.accounts[1].characters[0].guid = "Player-7777-00000001";
    payload.accounts[1].characters[0].realm = "";
    payload.accounts[1].characters[1].guid = "Player-8888-00000001";
    payload.accounts[1].characters[1].realm = "";

    const filled = fillRealms(payload, {
      byGuid: new Map([[MAGE, "Royaume Connu"]]),
      byServer: new Map([["7777", "Royaume En Base"]]),
      marketRealms: new Map(),
    });
    const [first, second] = filled.accounts;
    assert.equal(first.characters.find((c) => c.guid === MAGE)?.realm, "Royaume Connu");
    // Les autres personnages du compte 1 donnent le royaume du serveur 9999.
    assert.equal(first.characters.find((c) => c.guid === "Player-9999-000000AA")?.realm, "ClassicBetaPvE2");
    assert.deepEqual(first.warnings, payload.accounts[0].warnings);
    assert.deepEqual(second.characters.map((c) => [c.guid, c.realm]), [["Player-7777-00000001", "Royaume En Base"]]);
    assert.equal(second.warnings.length, payload.accounts[1].warnings.length + 1);
    assert.match(second.warnings.at(-1)!, /^personnage .+ ignoré : le jeu ne donne plus son royaume/);
    // L'entrée n'est pas modifiée.
    assert.equal(payload.accounts[0].characters[0].realm, "");
  });

  test("marché sans royaume : le royaume des personnages joués sans royaume, écrit comme les marchés connus", () => {
    const payload = structuredClone(EZ);
    const account = payload.accounts[0];
    account.characters[0].realm = "";
    account.ezAuctioneer!.markets[0].key = "3::Alliance:faction";
    account.ezAuctioneer!.deals = [{ market: "3::Alliance:faction", entries: [] }];
    account.ezAuctioneer!.portfolios![0].auctions = [{ id: 1, key: "i:2589", qty: 1, unit: 10, market: "3::Alliance:faction" }];

    const filled = fillRealms(payload, {
      ...NO_LOOKUPS,
      marketRealms: new Map([["_forever_", new Map([["ClassicBetaPvE2", "Classic Beta PvE 2"]])]]),
    }).accounts[0];
    assert.equal(filled.characters[0].realm, "ClassicBetaPvE2");
    assert.equal(filled.ezAuctioneer!.markets[0].key, "3:Classic Beta PvE 2:Alliance:faction");
    assert.equal(filled.ezAuctioneer!.deals![0].market, "3:Classic Beta PvE 2:Alliance:faction");
    assert.equal(filled.ezAuctioneer!.portfolios![0].auctions[0].market, "3:Classic Beta PvE 2:Alliance:faction");
    assert.deepEqual(filled.warnings, account.warnings);

    // Royaume jamais vu sur un marché : écrit tel que les personnages le donnent.
    assert.equal(fillRealms(payload, NO_LOOKUPS).accounts[0].ezAuctioneer!.markets[0].key, "3:ClassicBetaPvE2:Alliance:faction");
  });

  test("marché sans royaume d'un compte joué sur deux royaumes : écarté avec un avertissement", () => {
    const payload = structuredClone(EZ);
    const account = payload.accounts[0];
    account.characters[0].realm = "";
    account.characters[1].realm = "";
    account.ezAuctioneer!.markets[0].key = "3::Alliance:faction";
    account.ezAuctioneer!.portfolios![0].auctions = [{ id: 1, key: "i:2589", qty: 1, unit: 10, market: "3::Alliance:faction" }];

    const filled = fillRealms(payload, { ...NO_LOOKUPS, byGuid: new Map([[account.characters[1].guid, "Autre Royaume"]]) }).accounts[0];
    assert.deepEqual(filled.ezAuctioneer!.markets, []);
    assert.equal(filled.ezAuctioneer!.portfolios![0].auctions[0].market, undefined);
    assert.match(filled.warnings.at(-1)!, /^EZAuctioneer : marché « 3::Alliance:faction » ignoré : le jeu ne donne plus le royaume/);
  });
});

describe("royaume manquant : synchronisation", () => {
  let database: TestDatabase;
  let tokenId: number;
  let token: string;
  const sync = (payload: SyncPayload, now = NOW) => processSync(database.db, payload, { tokenId, requestId: "test", now });

  before(async () => {
    database = await openTestDatabase();
  });
  beforeEach(async () => {
    await database.reset();
    ({ id: tokenId, token } = await createAgentToken(database.db, "test"));
  });
  after(async () => {
    await database.close();
  });

  async function characterRows() {
    return database.db
      .select({ guid: t.characters.guid, realm: t.realms.name, level: t.characters.level })
      .from(t.characters)
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .orderBy(asc(t.characters.guid));
  }

  test("un personnage connu progresse sans royaume ; un nouveau du même serveur est créé dans son royaume", async () => {
    await sync(structuredClone(BASE));
    const before = await characterRows();

    const payload = structuredClone(BASE);
    const mage = payload.accounts[0].characters.find((c) => c.guid === MAGE)!;
    mage.level = (mage.level ?? 0) + 4;
    mage.lastSeen += 3_600;
    payload.accounts[1].characters.push({ ...structuredClone(mage), guid: "Player-9999-000000AA", name: "Nouveau Venu" });
    // Plus aucun royaume dans le document : les connus par leur GUID, le nouveau par son serveur en base.
    for (const character of payload.accounts.flatMap((account) => account.characters)) character.realm = "";

    const result = await sync(payload, new Date(NOW.getTime() + 3_600_000));
    assert.equal(result.status, "success");
    assert.equal(result.charactersCreated, 1);
    const after = await characterRows();
    assert.deepEqual(
      after.map((row) => row.realm),
      after.map(() => "ClassicBetaPvE2"),
    );
    assert.equal(after.find((row) => row.guid === MAGE)?.level, (before.find((row) => row.guid === MAGE)?.level ?? 0) + 4);
    assert.equal((await database.db.select().from(t.realms)).length, 1, "aucun royaume vide créé");
  });

  test("un personnage d'un serveur inconnu est écarté : synchronisation partielle, le reste est enregistré", async () => {
    const payload = structuredClone(BASE);
    payload.accounts[1].characters[0].guid = "Player-1234-00000001";
    payload.accounts[1].characters[0].realm = "";

    const result = await sync(payload);
    assert.equal(result.status, "partial");
    assert.equal(result.charactersReceived, 5);
    const errors = await database.db.select({ message: t.syncErrors.message }).from(t.syncErrors);
    assert.ok(errors.some((error) => /ignoré : le jeu ne donne plus son royaume/.test(error.message)));
  });

  test("les scans d'un marché sans royaume rejoignent le marché déjà connu", async () => {
    await sync(structuredClone(EZ));
    const payload = structuredClone(EZ);
    payload.accounts[0].characters[0].realm = "";
    payload.accounts[0].ezAuctioneer!.markets[0].key = "3::Alliance:faction";
    // Royaume du marché connu, différent de la forme normalisée des personnages.
    await database.db.update(t.realms).set({ name: "RoyaumeTestPvE" });

    await sync(payload, new Date(NOW.getTime() + 60_000));
    const errors = await database.db.select({ message: t.syncErrors.message }).from(t.syncErrors);
    assert.ok(!errors.some((error) => /royaume/.test(error.message)), JSON.stringify(errors));
    const markets = await database.db.select({ key: t.scanMarkets.marketKey, realm: t.scanMarkets.realm }).from(t.scanMarkets);
    assert.deepEqual(markets, [{ key: "3:Royaume Test PvE:Alliance:faction", realm: "Royaume Test PvE" }]);
  });

  test("l'API accepte un royaume vide et une clé de marché sans royaume", async () => {
    const payload = structuredClone(EZ);
    payload.accounts[0].characters[0].realm = "";
    payload.accounts[0].ezAuctioneer!.markets[0].key = "3::Alliance:faction";
    const response = await handleSyncRequest(
      new Request("https://wow.example.test/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }),
      { db: database.db, rateLimiter: new RateLimiter(), now: () => NOW, log: () => {} },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const markets = await database.db.select({ key: t.scanMarkets.marketKey }).from(t.scanMarkets);
    assert.deepEqual(markets, [{ key: "3:ClassicBetaPvE2:Alliance:faction" }]);
  });
});
