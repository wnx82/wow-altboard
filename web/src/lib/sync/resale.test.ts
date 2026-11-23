import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { RateLimiter } from "@/lib/rate-limit";
import { handleSyncRequest } from "./handler";
import { loadResale } from "@/lib/resale/load";
import { processSync } from "./process";
import { entryHashes, matchCharacter, parsePortfolioKey } from "./resale";
import { syncPayloadSchema, type PortfolioPayload, type SyncPayload } from "./schema";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/ezauctioneer-account.json"), "utf8"),
);
const NOW = new Date("2026-11-19T12:00:00Z");
const T0 = 1_795_079_000;

let database: TestDatabase;
let token: string;
let tokenId: number;

const buy = (at: number, key: string, qty: number, amount: number) => ({ at, kind: "buy" as const, key, qty, amount, source: "achat" });
const PORTFOLIO: PortfolioPayload = {
  key: "3:Royaume Test PvE:Élodie Brisefer",
  stats: { realized: -2_231, sales: 0, cuts: 0, expired: 1, depositsLost: 2_231, unknown: 0 },
  positions: [
    { key: "i:5266", qty: 1, cost: 16_800, listed: 1, openedAt: T0 },
    { key: "i:13133", qty: 2, cost: 99_796, listed: 0, openedAt: T0 + 12 },
  ],
  auctions: [{ id: 2_004_001, key: "i:5266", qty: 1, unit: 60_000, deposit: 2_231, cut: 0.05, market: "3:Royaume Test PvE:Alliance:faction", postedAt: T0 + 100 }],
  log: [
    buy(T0, "i:5266", 1, 16_800),
    buy(T0 + 12, "i:13133", 1, 49_898),
    buy(T0 + 12, "i:13133", 1, 49_898),
    { at: T0 + 100, kind: "post", key: "i:5266", qty: 1, unit: 60_000, deposit: 2_231 },
  ],
};

function payloadWith(changes: { portfolios?: PortfolioPayload[]; deals?: unknown[]; addonErrors?: unknown[]; runs?: unknown[] }): SyncPayload {
  const payload = structuredClone(BASE);
  const account = payload.accounts[0];
  if (changes.portfolios) account.ezAuctioneer!.portfolios = changes.portfolios;
  if (changes.deals) account.ezAuctioneer!.deals = changes.deals as never;
  if (changes.addonErrors) account.addonErrors = changes.addonErrors as never;
  if (changes.runs) account.characters[0].runs = changes.runs as never;
  return payload;
}

/** Le document de la fixture, tel qu'un agent antérieur à 0.11.0 l'enverrait : sans portefeuille ni erreurs. */
function legacy(): SyncPayload {
  const payload = structuredClone(BASE);
  delete payload.accounts[0].ezAuctioneer!.portfolios;
  delete payload.accounts[0].addonErrors;
  return payload;
}

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

describe("revente : règles", () => {
  test("clé de portefeuille : royaume vide admis, deux-points refusés dans le nom", () => {
    assert.deepEqual(parsePortfolioKey("3:CAMWOW EU5 Realm 5 PvE:Ada"), { region: "3", realm: "CAMWOW EU5 Realm 5 PvE", character: "Ada" });
    assert.deepEqual(parsePortfolioKey("3::Ada"), { region: "3", realm: "", character: "Ada" });
    assert.equal(parsePortfolioKey("3:Royaume:A:da"), null);
    assert.equal(parsePortfolioKey("Ada"), null);
  });

  test("personnage : nom exact, sinon prénom s'il est seul à le porter", () => {
    const candidates = [
      { id: 1, name: "Ada Brisefer" },
      { id: 2, name: "Ada" },
      { id: 3, name: "Bea Ambre" },
      { id: 4, name: "Bea Lune" },
      { id: 5, name: "Cléo Vent" },
    ];
    assert.equal(matchCharacter("Ada", candidates), 2);
    assert.equal(matchCharacter("Cléo", candidates), 5);
    assert.equal(matchCharacter("Bea", candidates), null);
    assert.equal(matchCharacter("Cl", candidates), null);
    assert.equal(matchCharacter("Ada Brisefer", candidates), 1);
  });

  test("empreintes du journal : stables, deux entrées identiques restent deux", () => {
    const hashes = entryHashes(PORTFOLIO.log);
    assert.equal(new Set(hashes).size, 4);
    assert.match(hashes[1], /:0$/);
    assert.match(hashes[2], /:1$/);
    // Les mêmes entrées, précédées d'une autre, gardent leur empreinte.
    assert.deepEqual(entryHashes([buy(T0 - 50, "i:1", 1, 1), ...PORTFOLIO.log]).slice(1), hashes);
  });

  test("le document de l'agent 0.11.0 est importé : portefeuille du personnage fictif, aucune erreur d'addon", async () => {
    const response = await post(structuredClone(BASE));
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200, JSON.stringify(json));
    assert.deepEqual([json.resalePortfolios, json.resaleEvents, json.resaleDeals], [1, 1, 0]);
    const [portfolio] = await database.db.select().from(t.resalePortfolios);
    // « Testeur » n'est pas un personnage d'AltBoard sur ce compte : rattaché à personne.
    assert.deepEqual([portfolio.characterName, portfolio.characterId], ["Testeur", null]);
  });

  test("le schéma refuse une entrée inconnue et accepte un document sans les nouveautés", () => {
    const bad = payloadWith({ portfolios: [{ ...PORTFOLIO, log: [{ ...PORTFOLIO.log[0], kind: "gift" as never }] }] });
    assert.equal(syncPayloadSchema.safeParse(bad).success, false);
    assert.equal(syncPayloadSchema.safeParse(payloadWith({ portfolios: [{ ...PORTFOLIO, key: "Ada" }] })).success, false);
    assert.equal(syncPayloadSchema.safeParse(legacy()).success, true);
  });
});

describe("revente : import", () => {
  test("portefeuille, positions, annonces et journal ; le personnage est retrouvé par son nom", async () => {
    const response = await post(payloadWith({ portfolios: [PORTFOLIO] }));
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 200, JSON.stringify(json));
    assert.deepEqual([json.resalePortfolios, json.resaleEvents], [1, 4]);

    const [portfolio] = await database.db.select().from(t.resalePortfolios);
    const [character] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.name, "Élodie Brisefer"));
    assert.equal(portfolio.characterId, character.id);
    assert.equal(portfolio.realm, "Royaume Test PvE");
    assert.deepEqual([portfolio.realizedCopper, portfolio.expired, portfolio.depositsLostCopper], [-2_231, 1, 2_231]);
    const positions = await database.db.select().from(t.resalePositions).orderBy(asc(t.resalePositions.itemId));
    assert.deepEqual(
      positions.map((row) => [row.itemKey, row.itemId, row.quantity, row.costCopper, row.listed]),
      [
        ["i:5266", 5266, 1, 16_800, 1],
        ["i:13133", 13133, 2, 99_796, 0],
      ],
    );
    const [auction] = await database.db.select().from(t.resaleAuctions);
    assert.deepEqual([auction.auctionId, auction.unitCopper, auction.cut, auction.postedAt?.getTime()], [2_004_001, 60_000, 0.05, (T0 + 100) * 1000]);
    assert.equal(await countRows(database.db, t.resaleEvents), 4);
  });

  test("le journal s'accumule sans doublon quand l'addon oublie les plus anciennes entrées", async () => {
    await sync(payloadWith({ portfolios: [PORTFOLIO] }));
    const sale = { at: T0 + 500, kind: "sale" as const, key: "i:5266", qty: 1, amount: 60_000, fee: 3_000, gain: 40_200 };
    const later = { ...PORTFOLIO, positions: PORTFOLIO.positions.slice(1), auctions: [], log: [...PORTFOLIO.log.slice(2), sale] };
    const result = await sync(payloadWith({ portfolios: [later] }));
    assert.equal(result.resaleEvents, 1);
    assert.equal(await countRows(database.db, t.resaleEvents), 5);
    assert.equal(await countRows(database.db, t.resalePositions), 1);
    assert.equal(await countRows(database.db, t.resaleAuctions), 0);
    // Renvoyé tel quel : rien de neuf.
    assert.equal((await sync(payloadWith({ portfolios: [later] }))).resaleEvents, 0);
  });

  test("un portefeuille disparu est remis à zéro, son journal reste ; un nom inconnu n'est rattaché à personne", async () => {
    await sync(payloadWith({ portfolios: [PORTFOLIO] }));
    // Prénom seul, comme EZAuctioneer l'enregistre sur WoW Forever : rattaché à « Zoé D'Ambre ».
    const firstName = { ...PORTFOLIO, key: "3::Zoé", positions: [], auctions: [], log: [] };
    const stranger = { ...PORTFOLIO, key: "3::Inconnu", positions: [], auctions: [], log: [buy(T0 + 900, "i:2589", 5, 100)] };
    await sync(payloadWith({ portfolios: [firstName, stranger] }));
    const rows = await database.db.select().from(t.resalePortfolios).orderBy(asc(t.resalePortfolios.id));
    assert.deepEqual(
      rows.map((row) => [row.characterName, row.characterId === null, row.realizedCopper, row.expired]),
      [
        ["Élodie Brisefer", false, 0, 0],
        ["Zoé", false, -2_231, 1],
        ["Inconnu", true, -2_231, 1],
      ],
    );
    assert.equal(await countRows(database.db, t.resalePositions), 0);
    assert.equal(await countRows(database.db, t.resaleEvents), 5);
  });

  test("deux PC : chacun son portefeuille et ses erreurs, une liste vide ne vide que le sien", async () => {
    const error = { at: T0, where: "Inventory:Scan", message: "attempt to index a nil value" };
    await sync(payloadWith({ portfolios: [PORTFOLIO], addonErrors: [error] }));
    const other = payloadWith({ portfolios: [{ ...PORTFOLIO, stats: { ...PORTFOLIO.stats, realized: 5_000 } }], addonErrors: [error] });
    other.machine.uuid = "00000000-0000-4000-8000-0000000000b2";
    // Un jeton est lié à son PC : le second PC a le sien.
    const second = await createAgentToken(database.db, "Second PC");
    const syncOther = (payload: SyncPayload) => processSync(database.db, payload, { tokenId: second.id, requestId: "test", now: NOW });
    await syncOther(other);
    assert.equal(await countRows(database.db, t.resalePortfolios), 2);
    assert.equal(await countRows(database.db, t.resalePositions), 4);
    assert.equal(await countRows(database.db, t.accountAddonErrors), 2);
    // Le second PC n'a plus rien : seul son portefeuille revient à zéro.
    const empty = payloadWith({ portfolios: [], addonErrors: [] });
    empty.machine.uuid = other.machine.uuid;
    await syncOther(empty);
    const rows = await database.db.select().from(t.resalePortfolios).orderBy(asc(t.resalePortfolios.id));
    assert.deepEqual(
      rows.map((row) => row.realizedCopper),
      [-2_231, 0],
    );
    assert.equal(await countRows(database.db, t.resalePositions), 2);
    assert.equal(await countRows(database.db, t.accountAddonErrors), 1);
    const data = await loadResale(database.db, NOW);
    // Un portefeuille par PC ; les deux PC de la fixture portent le même nom d'hôte.
    assert.equal(data.portfolios.length, 2);
  });

  test("un agent plus ancien, sans portefeuille, ne touche à rien", async () => {
    await sync(payloadWith({ portfolios: [PORTFOLIO] }));
    await sync(legacy());
    assert.equal(await countRows(database.db, t.resalePositions), 2);
  });

  test("affaires : la liste la plus récente d'un marché remplace la précédente", async () => {
    const entry = { key: "i:7094", kind: "resale", source: "scan", qty: 3, cost: 11_000, resale: 45_000, profit: 112_081, roi: 2.4, listings: 10, thin: false, live: "live" };
    const market = "3:Royaume Test PvE:Alliance:faction";
    await sync(payloadWith({ deals: [{ market, at: T0, entries: [entry, { ...entry, key: "i:3949", kind: "vendor" }] }] }));
    assert.equal(await countRows(database.db, t.resaleDeals), 2);
    // Plus ancienne : ignorée.
    assert.equal((await sync(payloadWith({ deals: [{ market, at: T0 - 60, entries: [entry] }] }))).resaleDeals, 0);
    assert.equal(await countRows(database.db, t.resaleDeals), 2);
    await sync(payloadWith({ deals: [{ market, at: T0 + 60, entries: [{ ...entry, live: "gone" }] }] }));
    const deals = await database.db.select().from(t.resaleDeals);
    assert.deepEqual(
      deals.map((row) => [row.rank, row.itemId, row.live, row.roi]),
      [[1, 7094, "gone", 2.4]],
    );
  });

  test("erreurs Lua de l'addon : remplacées, effacées par une liste vide, gardées sans liste", async () => {
    const error = { at: T0, where: "Inventory:Scan", message: "attempt to index a nil value", version: "0.8.3" };
    await sync(payloadWith({ addonErrors: [error, { ...error, at: T0 + 5 }] }));
    assert.equal(await countRows(database.db, t.accountAddonErrors), 2);
    await sync(legacy());
    assert.equal(await countRows(database.db, t.accountAddonErrors), 2);
    await sync(payloadWith({ addonErrors: [] }));
    assert.equal(await countRows(database.db, t.accountAddonErrors), 0);
    // Un message trop long est raccourci plutôt que de faire refuser le document.
    const response = await post(payloadWith({ addonErrors: [{ ...error, message: "x".repeat(900) }] }));
    assert.equal(response.status, 200);
    const [stored] = await database.db.select().from(t.accountAddonErrors);
    assert.equal(stored.message.length, 400);
  });

  test("donjons : enregistrés à part des sessions, complétés sans être effacés", async () => {
    const run = { startedAt: T0, stoppedAt: T0 + 1_150, durationSeconds: 1_150, zone: "Prison de Hurlevent", tag: "Dungeon", xpGained: 895, levels: 0, moneyCopper: 572, netCopper: 572, lootValueCopper: 1_525 };
    await sync(payloadWith({ runs: [run, { ...run, startedAt: T0 - 5_000, moneyCopper: -300, netCopper: -300 }] }));
    assert.equal(await countRows(database.db, t.characterRuns), 2);
    assert.equal(await countRows(database.db, t.characterSessions), 0);
    await sync(payloadWith({ runs: [{ startedAt: T0, zone: "Prison de Hurlevent" }] }));
    const rows = await database.db.select().from(t.characterRuns).orderBy(asc(t.characterRuns.startedAt));
    assert.deepEqual(
      rows.map((row) => [row.zone, row.netCopper, row.lootValueCopper]),
      [
        ["Prison de Hurlevent", -300, 1_525],
        ["Prison de Hurlevent", 572, 1_525],
      ],
    );
  });

  test("la page Revente lit portefeuilles, stock, journal et affaires", async () => {
    const sale = { at: T0 + 500, kind: "sale" as const, key: "i:5266", qty: 1, amount: 60_000, fee: 3_000, gain: 40_200 };
    const entry = { key: "i:7094", kind: "resale", qty: 3, cost: 11_000, resale: 45_000, profit: 112_081, roi: 2.4 };
    await sync(
      payloadWith({
        portfolios: [{ ...PORTFOLIO, log: [...PORTFOLIO.log, sale] }],
        deals: [{ market: "3:Royaume Test PvE:Alliance:faction", at: T0, entries: [entry] }],
      }),
    );
    const data = await loadResale(database.db, NOW);
    assert.equal(data.portfolios.length, 1);
    assert.equal(data.portfolios[0].name, "Élodie Brisefer");
    assert.equal(data.portfolios[0].positions, 2);
    assert.deepEqual(
      data.positions.map((row) => [row.itemKey, row.quantity]),
      [
        ["13133", 2],
        ["5266", 1],
      ],
    );
    assert.equal(data.auctions.length, 1);
    assert.equal(data.journalTotal, 5);
    assert.equal(data.journal[0].kind, "sale");
    assert.deepEqual(
      data.items.map((row) => [row.itemKey, row.gainCopper]),
      [
        ["5266", 40_200],
        ["13133", 0],
      ],
    );
    assert.equal(data.totals.invested, 116_596);
    assert.equal(data.deals.length, 1);
    assert.equal(data.deals[0].entries[0].itemKey, "7094");
  });
});
