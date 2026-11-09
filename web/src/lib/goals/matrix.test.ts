import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq, ne } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { listCharacters } from "@/lib/dashboard/queries";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { templateMatrices } from "./matrix";
import { addGoals, applyTemplate, saveTemplate } from "./store";

// Fixture : Élodie Brisefer (Player-9999-00000001), niveau 25, Couture 88.
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const MAGE = "Player-9999-00000001";
const NOW = new Date("2026-10-04T14:00:00Z");

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

describe("tableau des objectifs par modèle", () => {
  test("colonnes du modèle, une ligne par personnage qui l'a appliqué, le plus avancé d'abord", async () => {
    const [mage] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.guid, MAGE));
    const [other] = await database.db.select({ id: t.characters.id }).from(t.characters).where(ne(t.characters.guid, MAGE)).orderBy(asc(t.characters.id)).limit(1);
    await addGoals(
      database.db,
      mage.id,
      [
        { kind: "level", params: { target: 20 }, label: null },
        { kind: "profession", params: { subject: "Couture", target: 150 }, label: null },
        { kind: "manual", params: {}, label: "Monture" },
      ],
      NOW,
    );
    const saved = await saveTemplate(database.db, mage.id, "Base", NOW);
    assert.ok(saved.ok);
    await applyTemplate(database.db, other.id, saved.id, NOW);
    // Un objectif hors modèle n'apparaît pas dans le tableau.
    await addGoals(database.db, other.id, [{ kind: "level", params: { target: 40 }, label: null }], NOW);

    const [matrix] = await templateMatrices(database.db);

    assert.equal(matrix.name, "Base");
    assert.deepEqual(matrix.items.map((item) => item.kind), ["level", "profession", "manual"]);
    assert.equal(matrix.rows.length, 2);
    const mageRow = matrix.rows.find((row) => row.character.id === mage.id)!;
    assert.deepEqual([mageRow.done, mageRow.assigned], [1, 3]);
    assert.deepEqual(
      mageRow.cells.map((cell) => cell && [cell.reached, cell.progress]),
      [
        [true, "25 / 20"],
        [false, "88 / 150"],
        [false, null],
      ],
    );
    // Le mage a atteint le niveau 20 : il précède un personnage qui n'a rien atteint.
    assert.equal(matrix.rows[0].character.id, mage.id);

    // L'accueil compte les objectifs datés de chaque personnage.
    const goals = new Map((await listCharacters(database.db)).map((character) => [character.id, character.goals]));
    assert.deepEqual(goals.get(mage.id), { done: 1, total: 3 });
    assert.deepEqual(goals.get(other.id), { done: 0, total: 4 });
  });

  test("sans modèle, aucun tableau", async () => {
    assert.deepEqual(await templateMatrices(database.db), []);
  });
});
