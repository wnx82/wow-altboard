import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { CharacterPayload, SyncPayload } from "@/lib/sync/schema";
import type { GoalInput } from "./evaluate";
import { addGoals, applyTemplate, deleteGoal, listCharacterGoals, listTemplates, moveGoal, saveTemplate, setManualGoal } from "./store";

// Fixture : Élodie Brisefer, niveau 25, 8 po 9 pa 64 pc, Couture 88, Ironforge « Amical » (5),
// 7 × Pain de seigle invoqué (1114) dans les sacs, Mantelet rose (5274) porté.
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const MAGE = "Player-9999-00000001";
const NOW = new Date("2026-10-04T14:00:00Z");
const LATER = new Date("2026-10-05T09:30:00Z");

let database: TestDatabase;

const mageOf = (payload: SyncPayload): CharacterPayload => payload.accounts[0].characters.find((c) => c.guid === MAGE)!;

async function sync(payload: SyncPayload, now = NOW) {
  const { id } = await createAgentToken(database.db, "PC de test");
  return processSync(database.db, payload, { tokenId: id, requestId: "test", now });
}

async function mageId(): Promise<number> {
  const [row] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.guid, MAGE));
  return row.id;
}

const goal = (kind: GoalInput["kind"], params: GoalInput["params"], label: string | null = null): GoalInput => ({ kind, params, label });

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  await sync(BASE);
});

describe("objectifs d'un personnage", () => {
  test("progression lue sur les données synchronisées ; un objectif déjà atteint est daté à l'ajout", async () => {
    const id = await mageId();
    const result = await addGoals(
      database.db,
      id,
      [
        goal("level", { target: 20 }),
        goal("level", { target: 60 }),
        goal("profession", { subject: "Couture", target: 150 }),
        goal("reputation", { subject: "Ironforge", target: 8 }),
        goal("item", { subject: "1114", target: 5 }),
        goal("item", { subject: "5274", target: 1 }),
        goal("gold", { target: 8 }),
        goal("manual", {}, "Acheter la monture"),
      ],
      NOW,
    );
    assert.deepEqual(result, { ok: true, added: 8 });

    const goals = await listCharacterGoals(database.db, id);
    assert.deepEqual(
      goals.map((g) => [g.label, g.progress.current, g.progress.reached, g.achievedAt?.toISOString() ?? null]),
      [
        ["Atteindre le niveau 20", 25, true, NOW.toISOString()],
        ["Atteindre le niveau 60", 25, false, null],
        ["Couture au rang 150", 88, false, null],
        ["Exalté auprès de : Ironforge", 5, false, null],
        ["Posséder 5 × Pain de seigle invoqué", 7, true, NOW.toISOString()],
        ["Posséder 1 × Mantelet rose", 1, true, NOW.toISOString()],
        ["Réunir 8 po", 8, true, NOW.toISOString()],
        ["Acheter la monture", null, false, null],
      ],
    );
  });

  test("la synchronisation date l'objectif que le document fait atteindre, une seule fois", async () => {
    const id = await mageId();
    await addGoals(database.db, id, [goal("level", { target: 26 }), goal("gold", { target: 50 })], NOW);

    const next = structuredClone(BASE);
    Object.assign(mageOf(next), { level: 26, lastSeen: mageOf(BASE).lastSeen + 3600 });
    await sync(next, LATER);

    let goals = await listCharacterGoals(database.db, id);
    assert.deepEqual(goals.map((g) => g.achievedAt?.toISOString() ?? null), [LATER.toISOString(), null]);

    // Le niveau ne redescend pas, mais un nouvel envoi ne change pas la date.
    const again = structuredClone(next);
    mageOf(again).lastSeen += 3600;
    await sync(again, new Date(LATER.getTime() + 3_600_000));
    goals = await listCharacterGoals(database.db, id);
    assert.equal(goals[0].achievedAt?.toISOString(), LATER.toISOString());
  });

  test("un objectif atteint le reste quand la valeur redescend", async () => {
    const id = await mageId();
    await addGoals(database.db, id, [goal("gold", { target: 8 })], NOW);

    const poorer = structuredClone(BASE);
    Object.assign(mageOf(poorer), { moneyCopper: 100, lastSeen: mageOf(BASE).lastSeen + 3600 });
    await sync(poorer, LATER);

    const [gold] = await listCharacterGoals(database.db, id);
    assert.deepEqual([gold.progress.current, gold.progress.reached, gold.achievedAt?.toISOString()], [0, true, NOW.toISOString()]);
  });

  test("cocher à la main ne vaut que pour un objectif à cocher soi-même", async () => {
    const id = await mageId();
    await addGoals(database.db, id, [goal("manual", {}, "Faire le donjon"), goal("level", { target: 60 })], NOW);
    const [manual, level] = await listCharacterGoals(database.db, id);

    assert.equal(await setManualGoal(database.db, manual.id, true, LATER), true);
    assert.equal(await setManualGoal(database.db, level.id, true, LATER), false);
    let goals = await listCharacterGoals(database.db, id);
    assert.deepEqual(goals.map((g) => g.progress.reached), [true, false]);

    await setManualGoal(database.db, manual.id, false, LATER);
    goals = await listCharacterGoals(database.db, id);
    assert.equal(goals[0].achievedAt, null);
  });

  test("réordonner échange deux voisins ; supprimer retire l'objectif", async () => {
    const id = await mageId();
    await addGoals(database.db, id, ["A", "B", "C"].map((label) => goal("manual", {}, label)), NOW);
    const [a, , c] = await listCharacterGoals(database.db, id);

    assert.equal(await moveGoal(database.db, c.id, "up", NOW), true);
    assert.equal(await moveGoal(database.db, a.id, "up", NOW), false);
    assert.deepEqual((await listCharacterGoals(database.db, id)).map((g) => [g.label, g.position]), [["A", 1], ["C", 2], ["B", 3]]);

    assert.equal(await deleteGoal(database.db, a.id), true);
    assert.deepEqual((await listCharacterGoals(database.db, id)).map((g) => g.label), ["C", "B"]);
  });

  test("un personnage supprimé emporte ses objectifs ; un personnage inconnu est refusé", async () => {
    const id = await mageId();
    await addGoals(database.db, id, [goal("manual", {}, "A")], NOW);
    await database.db.delete(t.characters).where(eq(t.characters.id, id));

    assert.equal(await countRows(database.db, t.characterGoals), 0);
    assert.deepEqual(await addGoals(database.db, id, [goal("manual", {}, "A")], NOW), { ok: false, error: "Personnage inconnu." });
  });
});

describe("modèles", () => {
  test("enregistrer puis réappliquer un modèle, sans doublon, à un autre personnage et après une réinitialisation", async () => {
    const id = await mageId();
    await addGoals(database.db, id, [goal("level", { target: 20 }), goal("manual", {}, "Acheter la monture")], NOW);
    await setManualGoal(database.db, (await listCharacterGoals(database.db, id))[1].id, true, NOW);

    const saved = await saveTemplate(database.db, id, "  Montée   en niveau ", NOW);
    assert.ok(saved.ok);
    assert.deepEqual(await listTemplates(database.db), [{ id: saved.id, name: "Montée en niveau", goals: 2 }]);

    // Réappliqué au même personnage : rien de nouveau.
    assert.deepEqual(await applyTemplate(database.db, id, saved.id, NOW), { ok: true, added: 0 });

    // Personnage supprimé puis recréé (réinitialisation) : le modèle a survécu.
    await database.db.delete(t.characters);
    await sync(BASE, LATER);
    const recreated = await mageId();
    assert.deepEqual(await applyTemplate(database.db, recreated, saved.id, LATER), { ok: true, added: 2 });
    const goals = await listCharacterGoals(database.db, recreated);
    // Sans les dates du modèle : seul l'objectif que les données atteignent est coché.
    assert.deepEqual(goals.map((g) => [g.label, g.achievedAt?.toISOString() ?? null]), [
      ["Atteindre le niveau 20", LATER.toISOString()],
      ["Acheter la monture", null],
    ]);
  });

  test("un modèle de même nom est remplacé ; nom vide ou liste vide refusés", async () => {
    const id = await mageId();
    assert.equal((await saveTemplate(database.db, id, "Métiers", NOW)).ok, false);
    await addGoals(database.db, id, [goal("manual", {}, "A")], NOW);
    assert.equal((await saveTemplate(database.db, id, "   ", NOW)).ok, false);

    const first = await saveTemplate(database.db, id, "Métiers", NOW);
    await addGoals(database.db, id, [goal("manual", {}, "B")], NOW);
    const second = await saveTemplate(database.db, id, "Métiers", LATER);

    assert.ok(first.ok && second.ok && first.id === second.id);
    assert.deepEqual(await listTemplates(database.db), [{ id: first.id, name: "Métiers", goals: 2 }]);
  });
});
