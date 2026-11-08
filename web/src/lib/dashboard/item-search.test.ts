import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { parseItemQuery, searchItemOwners } from "./item-search";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const NOW = new Date("2026-10-04T14:00:00Z");

let database: TestDatabase;

before(async () => {
  database = await openTestDatabase();
  await database.reset();
  const { id } = await createAgentToken(database.db, "PC de test");
  await processSync(database.db, BASE, { tokenId: id, requestId: "test", now: NOW });
});

after(async () => {
  await database.close();
});

describe("recherche d'objets", () => {
  test("saisie : identifiant, mots du nom, ou rien d'exploitable", () => {
    assert.deepEqual(parseItemQuery(" 2589 "), { itemId: 2589 });
    assert.deepEqual(parseItemQuery("  étoffe   de lin "), { words: "étoffe de lin" });
    assert.equal(parseItemQuery("é"), null);
    assert.equal(parseItemQuery(""), null);
    assert.equal(parseItemQuery(undefined), null);
    assert.equal(parseItemQuery("0"), null);
  });

  test("par le nom, sans tenir compte des accents ni de la casse : chaque détenteur et le total", async () => {
    const { items } = await searchItemOwners(database.db, { words: "PAIN DE SEIGLE" });

    const bread = items.find((item) => item.itemId === 1114);
    assert.ok(bread, JSON.stringify(items.map((i) => i.name)));
    assert.equal(bread.name, "Pain de seigle invoqué");
    assert.ok(bread.holdings.some((h) => h.characterName === "Élodie Brisefer" && h.location === "bags" && h.quantity === 7));
    assert.equal(bread.total, bread.holdings.reduce((sum, h) => sum + h.quantity, 0));

    const accentless = await searchItemOwners(database.db, { words: "seigle invoque" });
    assert.ok(accentless.items.some((item) => item.itemId === 1114));
  });

  test("par l'identifiant : un objet porté compte pour un, en équipement", async () => {
    const { items } = await searchItemOwners(database.db, { itemId: 5274 });

    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Mantelet rose");
    assert.ok(items[0].holdings.some((h) => h.location === "equipped" && h.quantity === 1));
  });

  test("les caractères spéciaux du motif LIKE sont cherchés tels quels", async () => {
    assert.deepEqual((await searchItemOwners(database.db, { words: "%%" })).items, []);
    assert.deepEqual((await searchItemOwners(database.db, { words: "__" })).items, []);
  });

  test("un identifiant jamais vu ne donne rien", async () => {
    assert.deepEqual((await searchItemOwners(database.db, { itemId: 999_999 })).items, []);
  });
});
