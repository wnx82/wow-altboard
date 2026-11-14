import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import {
  bestOf,
  equipmentRows,
  levelTimeRows,
  listCompareOptions,
  loadComparison,
  MAX_COMPARED,
  professionRows,
  readCompareIds,
  reputationRows,
  statRows,
} from "./compare";

const collator = new Intl.Collator("fr", { sensitivity: "base" });
/** Espaces insécables des nombres français remplacés par des espaces ordinaires. */
const plain = (values: (string | null)[]) => values.map((value) => value?.replace(/[\u00a0\u202f]/g, " ") ?? null);

describe("comparateur : lignes", () => {
  test("personnages de l'adresse : dans l'ordre, sans doublon ni valeur invalide, quatre au plus", () => {
    assert.deepEqual(readCompareIds({ c: ["12", "7", "12", "abc", "", "0"] }), [12, 7]);
    assert.deepEqual(readCompareIds({ c: "3,4" }), [3, 4]);
    assert.deepEqual(readCompareIds({}), []);
    assert.equal(readCompareIds({ c: ["1", "2", "3", "4", "5", "6"] }).length, MAX_COMPARED);
  });

  test("meilleure valeur : seulement entre deux valeurs connues qui diffèrent", () => {
    assert.deepEqual(bestOf([10, 20, 20]), [1, 2]);
    assert.deepEqual(bestOf([10, 20], true), [0]);
    assert.deepEqual(bestOf([10, null]), []);
    assert.deepEqual(bestOf([5, 5]), []);
  });

  test("statistiques : lignes connues seulement, pourcentages, ressources de nature différente non comparées", () => {
    const base = { characterId: 0, powerType: null } as const;
    const empty = Object.fromEntries(
      ["strength", "agility", "stamina", "intellect", "spirit", "armor", "health", "power", "attackPower", "rangedAttackPower", "crit", "rangedCrit", "hit", "dodge", "parry", "block", "defense", "spellPower", "spellCrit", "healing", "spellHit", "resFire", "resNature", "resFrost", "resShadow", "resArcane"].map(
        (key) => [key, null],
      ),
    );
    const mage = { ...base, ...empty, characterId: 1, intellect: 120, crit: 5.5, power: 3000, powerType: "MANA" };
    const warrior = { ...base, ...empty, characterId: 2, intellect: 30, crit: 7.25, power: 100, powerType: "RAGE" };
    const rows = statRows([mage, warrior, null] as Parameters<typeof statRows>[0]);
    assert.deepEqual(
      rows.map((row) => [row.label, plain(row.values), row.best]),
      [
        ["Intelligence", ["120", "30", null], [0]],
        ["Ressource", ["3 000 (MANA)", "100 (RAGE)", null], []],
        ["Critique", ["5,50 %", "7,25 %", null], [1]],
      ],
    );
  });

  test("équipement : emplacements occupés chez au moins un, plus haut niveau d'objet en tête", () => {
    const rows = equipmentRows([
      [{ slot: 1, name: "Casque A", quality: 2, itemLevel: 20, itemId: 1 }],
      [
        { slot: 1, name: "Casque B", quality: 3, itemLevel: 25, itemId: 2 },
        { slot: 16, name: "Épée", quality: 2, itemLevel: 18, itemId: 3 },
      ],
    ]);
    assert.deepEqual(
      rows.map((row) => [row.label, row.items.map((item) => item?.name ?? null), row.best]),
      [
        ["Tête", ["Casque A", "Casque B"], [1]],
        ["Main droite", [null, "Épée"], []],
      ],
    );
  });

  test("métiers, réputations et temps par niveau", () => {
    assert.deepEqual(
      professionRows(
        [
          [{ skillLine: 186, name: "Minage", rank: 120, maxRank: 150 }],
          [
            { skillLine: 186, name: "Minage", rank: 75, maxRank: 150 },
            { skillLine: 164, name: "Forge", rank: 10, maxRank: 75 },
          ],
        ],
        collator.compare,
      ).map((row) => [row.label, row.values, row.best]),
      [
        ["Forge", [null, "10 / 75"], []],
        ["Minage", ["120 / 150", "75 / 150"], [0]],
      ],
    );

    const reputations = reputationRows(
      [
        [{ factionId: 72, name: "Hurlevent", groupName: "Alliance", reaction: 5, currentValue: 4_000, minValue: 3_000 }],
        [
          { factionId: 72, name: "Hurlevent", groupName: "Alliance", reaction: 5, currentValue: 5_000, minValue: 3_000 },
          { factionId: 21, name: "Baie-du-Butin", groupName: null, reaction: 4, currentValue: 0, minValue: 0 },
        ],
      ],
      (reaction) => ["", "", "", "", "Neutre", "Amical"][reaction],
      collator.compare,
    );
    assert.deepEqual(
      reputations.map((row) => [row.group, row.label, plain(row.values), row.best]),
      [
        ["Alliance", "Hurlevent", ["Amical · 1 000", "Amical · 2 000"], [1]],
        ["Autres", "Baie-du-Butin", [null, "Neutre · 0"], []],
      ],
    );

    assert.deepEqual(
      levelTimeRows(
        [
          [
            { level: 1, playedSeconds: 600 },
            { level: 2, playedSeconds: null },
          ],
          [{ level: 1, playedSeconds: 900 }],
        ],
        (seconds) => `${seconds} s`,
      ).map((row) => [row.label, row.values, row.best]),
      [
        ["1 → 2", ["600 s", "900 s"], [0]],
        ["2 → 3", [null, null], []],
      ],
    );
  });
});

describe("comparateur : lecture en base", () => {
  let database: TestDatabase;
  const BASE: SyncPayload = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"));

  before(async () => {
    database = await openTestDatabase();
  });
  after(async () => {
    await database.close();
  });
  beforeEach(async () => {
    await database.reset();
  });

  test("personnages dans l'ordre demandé, identifiant inconnu ignoré, données de chacun séparées", async () => {
    const { id } = await createAgentToken(database.db, "PC de test");
    await processSync(database.db, BASE, { tokenId: id, requestId: "test", now: new Date("2026-10-04T14:00:00Z") });
    const options = await listCompareOptions(database.db);
    assert.equal(options.length, 6);
    const [first, second] = [options[1], options[0]];

    const compared = await loadComparison(database.db, [first.id, 999_999, second.id]);
    assert.deepEqual(
      compared.map((character) => character.name),
      [first.name, second.name],
    );
    const payload = BASE.accounts.flatMap((account) => account.characters);
    for (const character of compared) {
      const source = payload.find((entry) => entry.name === character.name)!;
      assert.equal(character.equipment.length, source.gear.length, `${character.name} : équipement`);
      assert.equal(character.reputations.length, source.reputations.length, `${character.name} : réputations`);
      assert.equal(character.professions.length, source.professions.length, `${character.name} : métiers`);
    }
    assert.deepEqual(await loadComparison(database.db, []), []);
  });
});
