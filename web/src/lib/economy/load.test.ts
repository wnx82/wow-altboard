import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { writeSettings } from "@/lib/settings/store";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { listImports, markPartialDays } from "./audit";
import { sortCrafts, summarizeProfessions } from "./craft-view";
import { loadFacts } from "./facts-service";
import { itemLabel, loadCoverage, loadEconomy, loadHoldings, loadItemHistory, loadItemsHistory } from "./load";
import { buildMarketView, PAGE_SIZE } from "./market-view";
import { ensureOpportunityRun, latestOpportunities, readRun } from "./runs";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");

let database: TestDatabase;
let tokenId: number;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  tokenId = (await createAgentToken(database.db, "PC de test")).id;
  await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "test", now: NOW });
});

describe("chargement du moteur", () => {
  test("statistiques, recettes connues et crafts évalués depuis la base", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    assert.equal(context.market.auctionKey, "PvE");
    assert.equal(context.today, "2026-11-06");
    assert.equal(context.historyFrom, null);
    assert.equal(context.auctionCut, 0.05);
    assert.equal(context.stats.size, 40);
    assert.equal(context.recipes.length, 37);
    assert.equal(context.crafts.length, 37);
    assert.ok(context.recipes.every((r) => r.characters.length === 1));
    const item = context.stats.get("2576")!;
    assert.equal(item.current?.minCopper, 100);
    assert.equal(item.lastDay, "2026-11-06");
    // Chaque décision est justifiée par au moins une raison.
    assert.ok(context.crafts.every((c) => c.reasons.length > 0));
  });

  test("détenteurs d'un objet : sacs et banque par personnage, plus gros stock d'abord", async () => {
    const [first, second] = await database.db.select({ id: t.characters.id, name: t.characters.name }).from(t.characters).orderBy(t.characters.id).limit(2);
    assert.ok(first && second, "la fixture compte au moins deux personnages");
    await database.db.insert(t.characterItems).values([
      { characterId: second.id, location: "bags", itemKey: "99001", quantity: 2 },
      { characterId: second.id, location: "bank", itemKey: "99001", quantity: 4 },
      { characterId: first.id, location: "bank", itemKey: "99001", quantity: 1 },
      { characterId: first.id, location: "bags", itemKey: "99002", quantity: 3 },
    ]);

    const holdings = await loadHoldings(database.db, ["99001", "99001"]);
    assert.deepEqual([...holdings.keys()], ["99001"]);
    assert.deepEqual(
      holdings.get("99001")!.map(({ characterId, quantity, bags, bank }) => ({ characterId, quantity, bags, bank })),
      [
        { characterId: second.id, quantity: 6, bags: 2, bank: 4 },
        { characterId: first.id, quantity: 1, bags: 0, bank: 1 },
      ],
    );
    assert.equal((await loadHoldings(database.db, [])).size, 0);

    // Le moteur lit les mêmes détenteurs, et le stock en est la somme.
    const context = (await loadEconomy(database.db, { now: NOW }))!;
    assert.deepEqual(context.holdings.get("99001"), holdings.get("99001"));
    assert.equal(context.stock.get("99001"), 7);
    assert.equal(context.stock.get("99002"), 3);
  });

  test("le début de l'historique suit la date limite des personnages", async () => {
    await writeSettings(database.db, { charactersCutoffAt: new Date("2026-11-04T00:30:00Z") }, NOW);

    const context = (await loadEconomy(database.db, { now: NOW }))!;

    assert.equal(context.historyFrom, "2026-11-04");
    assert.ok([...context.stats.values()].every((s) => s.lastDay === null || s.lastDay >= "2026-11-04"));
    const coverage = await loadCoverage(database.db, context.market.id, context.historyFrom);
    assert.ok(coverage.every((c) => c.day >= "2026-11-04"));
  });

  test("historique d'un objet et nom de repli", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const history = await loadItemHistory(database.db, context.market.id, "2576");
    assert.deepEqual(history.map((d) => d.day), ["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-22", "2026-11-05", "2026-11-06"]);
    assert.equal(itemLabel(context.names, "999999"), "Objet 999999");
    assert.equal(itemLabel(context.names, "g:999999:60"), "Objet 999999 (niveau 60)");
  });

  test("un calcul d'opportunités est conservé, puis réutilisé tant que sa base ne change pas", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const first = await ensureOpportunityRun(database.db, context, NOW);
    const second = await ensureOpportunityRun(database.db, (await loadEconomy(database.db, { now: NOW }))!, NOW);

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.id, first.id);
    assert.deepEqual(second.opportunities, first.opportunities);
    assert.equal(await countRows(database.db, t.opportunityRuns), 1);
    const stored = (await readRun(database.db, first.id))!;
    assert.equal(stored.opportunities.length, first.opportunities.length);

    // Une nouvelle synchronisation (stocks, recettes) change la base du calcul.
    await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "again", now: new Date(NOW.getTime() + 60_000) });
    const third = await ensureOpportunityRun(database.db, (await loadEconomy(database.db, { now: NOW }))!, NOW);
    assert.equal(third.reused, false);
    assert.equal(await countRows(database.db, t.opportunityRuns), 2);
  });

  test("un fichier plus ancien reçu après coup ne passe pas pour le dernier relevé, mais change la base du calcul", async () => {
    const first = (await loadEconomy(database.db, { now: NOW }))!;
    const run = await ensureOpportunityRun(database.db, first, NOW);
    const older = structuredClone(BASE);
    const account = older.accounts[0];
    account.accountKey = "b".repeat(64);
    account.characters = [];
    delete account.recipes;
    for (const market of account.auctionator!.markets) {
      market.contentHash = "c".repeat(64);
      // Jour Auctionator 2486 = 2026-10-22 : rien d'aussi récent que le premier fichier.
      for (const item of market.items) item.days = item.days.filter((d) => d[0]! <= 2486);
      market.items = market.items.filter((item) => item.days.length > 0);
    }
    await processSync(database.db, older, { tokenId, requestId: "older", now: new Date(NOW.getTime() + 60_000) });

    const context = (await loadEconomy(database.db, { now: NOW }))!;
    assert.equal(context.lastImport!.lastDay, "2026-11-06");
    assert.notEqual(context.newestImportId, context.lastImport!.id);
    assert.equal((await ensureOpportunityRun(database.db, context, NOW)).id === run.id, false);
  });

  test("sans aucun prix reçu, rien n'est calculé", async () => {
    await database.reset();

    assert.equal(await loadEconomy(database.db, { now: NOW }), null);
    assert.equal(await loadFacts(database.db, { now: NOW }), null);
    assert.equal(await latestOpportunities(database.db), null);
  });
});

describe("vues des pages", () => {
  test("marché : recherche par identifiant, filtre du stock, pages bornées", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const all = buildMarketView(context, { query: "", owned: false, sort: "name", page: 99 });
    assert.equal(all.total, 40);
    assert.equal(all.page, 1);
    assert.equal(all.rows.length, Math.min(40, PAGE_SIZE));
    assert.deepEqual(buildMarketView(context, { query: "2576", owned: false, sort: "held", page: 1 }).rows.map((r) => r.itemKey), ["2576"]);
    const owned = buildMarketView(context, { query: "", owned: true, sort: "held", page: 1 });
    assert.ok(owned.rows.every((r) => r.owned > 0));
    assert.equal(owned.total, owned.held);
    // Les variations mises en avant sont signées dans le bon sens.
    assert.ok(all.rising.every((r) => r.stats.change7d! > 0));
    assert.ok(all.falling.every((r) => r.stats.change7d! < 0));
    assert.ok(all.anomalies.every((r) => r.stats.outlier));
  });

  test("craft : crafts à faire d'abord, bilan par métier cohérent avec les décisions", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;
    const bySpell = new Map(context.recipes.map((r) => [r.spellId, r]));
    const rows = sortCrafts(context.crafts.map((craft) => ({ craft, recipe: bySpell.get(craft.spellId)! })));

    const order = ["CRAFT", "SELL_REAGENTS", "WAIT", "DONT_CRAFT"];
    for (let i = 1; i < rows.length; i++) assert.ok(order.indexOf(rows[i - 1].craft.decision) <= order.indexOf(rows[i].craft.decision));
    const professions = summarizeProfessions(rows, (s) => context.professions.get(s ?? 0) ?? String(s));
    assert.equal(professions.reduce((total, p) => total + p.recipes, 0), rows.length);
    assert.equal(
      professions.reduce((total, p) => total + p.profitable, 0),
      rows.filter((r) => r.craft.decision === "CRAFT").length,
    );
  });

  test("faits structurés : dernier relevé, confiance et opportunités du calcul conservé", async () => {
    const result = (await loadFacts(database.db, { now: NOW }))!;

    assert.equal(result.facts.market.lastScanDay, "2026-11-06");
    assert.equal(result.facts.market.auctionCutPercent, 5);
    assert.equal(result.facts.engine.run, result.run.id);
    assert.equal(result.facts.opportunities.length, Math.min(15, result.run.opportunities.length));
    assert.ok(result.facts.opportunities.every((o) => o.confidence >= 0 && o.confidence <= 100 && o.lastDay !== undefined));
    assert.ok(result.facts.rules.length > 0);
    // Variations en pourcentage, prêtes à citer : 100 pc le 06/11 contre 700 pc le 22/10.
    const fallen = result.facts.falling.find((f) => f.item === "2576");
    assert.equal(fallen?.change7dPercent, -85.7);
    assert.ok(result.facts.rising.every((f) => f.change7dPercent! > 0));
    // Aucun calcul de plus pour la même base : les faits citent le calcul déjà conservé.
    const again = (await loadFacts(database.db, { now: NOW }))!;
    assert.equal(again.run.id, result.run.id);
    assert.equal(again.run.reused, true);
  });

  test("audit : relevé reçu une fois, historique de plusieurs objets, jours partiels", async () => {
    const context = (await loadEconomy(database.db, { now: NOW }))!;

    const imports = await listImports(database.db, context.market.id);
    assert.equal(imports.length, 1);
    assert.equal(imports[0].items, 40);
    const histories = await loadItemsHistory(database.db, context.market.id, ["2576", "999999"]);
    assert.equal(histories.get("2576")!.length, 6);
    assert.deepEqual(histories.get("999999"), []);
    assert.deepEqual(
      markPartialDays([{ day: "a", items: 100 }, { day: "b", items: 40 }, { day: "c", items: 90 }]).map((d) => d.partial),
      [false, true, false],
    );
  });
});
