import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { pruneHistory } from "@/lib/maintenance/retention";
import { addTag, loadNotebook, loadNotebooks, normalizeNote, normalizeTag, removeTag, saveNote, usedTags } from "@/lib/notebook/store";
import { writeSettings } from "@/lib/settings/store";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { DEFAULT_RESET } from "./period";
import { createItem, deleteItem, listChecklist, loadResetRule, setCheck, updateItem } from "./store";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
// Mercredi 25 novembre 2026, 10 h de Bruxelles : la semaine a commencé ce matin à 5 h.
const NOW = new Date("2026-11-25T09:00:00Z");

let database: TestDatabase;
let ids: number[];

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  const { id } = await createAgentToken(database.db, "PC de test");
  await processSync(database.db, BASE, { tokenId: id, requestId: "test", now: new Date("2026-10-04T14:00:00Z") });
  ids = (await database.db.select({ id: t.characters.id }).from(t.characters).orderBy(asc(t.characters.id))).map((row) => row.id);
});

describe("carnet d'un personnage", () => {
  test("étiquettes : minuscules, espaces réduits, caractères permis seulement", () => {
    assert.equal(normalizeTag("  Banque   Principale "), "banque principale");
    assert.equal(normalizeTag("Élevage d'or"), "élevage d'or");
    assert.equal(normalizeTag("pvp-2"), "pvp-2");
    assert.equal(normalizeTag(""), null);
    assert.equal(normalizeTag("<script>"), null);
    assert.equal(normalizeTag("x".repeat(25)), null);
    assert.equal(normalizeNote("  ligne 1\r\nligne 2  "), "ligne 1\nligne 2");
    assert.equal(normalizeNote(" \n "), null);
  });

  test("note enregistrée, remplacée puis effacée ; étiquettes sans doublon, huit au plus", async () => {
    const [first, second] = ids;
    assert.deepEqual(await saveNote(database.db, first, " Farm cuir à Tanaris ", NOW), { ok: true, note: "Farm cuir à Tanaris" });
    await saveNote(database.db, first, "Banque des tissus", NOW);
    assert.equal((await loadNotebook(database.db, first)).note, "Banque des tissus");
    assert.equal((await saveNote(database.db, first, "x".repeat(2001), NOW)).ok, false);

    assert.deepEqual(await addTag(database.db, first, "Principal", NOW), { ok: true, tag: "principal" });
    assert.deepEqual(await addTag(database.db, first, "principal", NOW), { ok: true, tag: "principal" });
    await addTag(database.db, second, "banque", NOW);
    await addTag(database.db, first, "banque", new Date(NOW.getTime() + 1000));
    assert.deepEqual((await loadNotebook(database.db, first)).tags, ["principal", "banque"]);
    assert.deepEqual(await usedTags(database.db), ["banque", "principal"]);
    for (let index = 0; index < 6; index++) await addTag(database.db, first, `tag ${index}`, NOW);
    assert.deepEqual(await addTag(database.db, first, "de trop", NOW), { ok: false, error: "8 étiquettes au plus par personnage." });

    await removeTag(database.db, first, "principal");
    await saveNote(database.db, first, "   ", NOW);
    const books = await loadNotebooks(database.db, [first, second]);
    assert.equal(books.get(first)?.note, null);
    assert.equal(books.get(first)?.tags.includes("principal"), false);
    assert.deepEqual(books.get(second), { note: null, tags: ["banque"] });
  });
});

describe("listes à cocher", () => {
  test("une tâche par personnage choisi ; coche valable jusqu'à la réinitialisation suivante", async () => {
    const [first, second] = ids;
    const created = await createItem(database.db, { label: "  Quête   de cuisine ", period: "daily", characterIds: [first, second, first, 999_999] }, NOW);
    assert.equal(created.ok, true);
    const itemId = created.ok ? created.id : 0;
    assert.equal(await countRows(database.db, t.checklistItemCharacters), 2);

    assert.equal(await setCheck(database.db, itemId, first, true, NOW, DEFAULT_RESET), true);
    // Personnage non relié à la tâche : rien n'est écrit.
    assert.equal(await setCheck(database.db, itemId, 999_999, true, NOW, DEFAULT_RESET), false);

    const [item] = await listChecklist(database.db, NOW, DEFAULT_RESET);
    assert.equal(item.label, "Quête de cuisine");
    assert.equal(item.periodStart, "2026-11-25");
    assert.deepEqual(item.members, [
      { characterId: first, done: true },
      { characterId: second, done: false },
    ]);
    // Le lendemain à 6 h de Bruxelles, la tâche du jour est à refaire.
    const [tomorrow] = await listChecklist(database.db, new Date("2026-11-26T05:00:00Z"), DEFAULT_RESET);
    assert.deepEqual(tomorrow.members.map((member) => member.done), [false, false]);
    // Vue d'un seul personnage.
    assert.deepEqual((await listChecklist(database.db, NOW, DEFAULT_RESET, second)).map((entry) => entry.members), [[{ characterId: second, done: false }]]);
    assert.deepEqual(await listChecklist(database.db, NOW, DEFAULT_RESET, ids.at(-1)! + 1000), []);
  });

  test("modifier les personnages retire leurs coches ; supprimer la tâche retire tout", async () => {
    const [first, second, third] = ids;
    const created = await createItem(database.db, { label: "Raid", period: "weekly", characterIds: [first, second] }, NOW);
    const itemId = created.ok ? created.id : 0;
    await setCheck(database.db, itemId, first, true, NOW, DEFAULT_RESET);
    await setCheck(database.db, itemId, second, true, NOW, DEFAULT_RESET);

    assert.deepEqual(await updateItem(database.db, itemId, { label: "Raid Onyxia", period: "weekly", characterIds: [second, third] }, NOW), { ok: true });
    const [item] = await listChecklist(database.db, NOW, DEFAULT_RESET);
    assert.equal(item.label, "Raid Onyxia");
    assert.deepEqual(
      item.members.map((member) => [member.characterId, member.done]),
      [
        [second, true],
        [third, false],
      ],
    );
    assert.equal(await countRows(database.db, t.checklistChecks), 1);
    assert.deepEqual(await updateItem(database.db, itemId, { label: "Raid", period: "weekly", characterIds: [] }, NOW), { ok: false, error: "Choisissez au moins un personnage." });

    assert.equal(await deleteItem(database.db, itemId), true);
    assert.equal(await countRows(database.db, t.checklistItemCharacters), 0);
    assert.equal(await countRows(database.db, t.checklistChecks), 0);
  });

  test("refus : intitulé vide ou trop long, aucun personnage connu", async () => {
    assert.equal((await createItem(database.db, { label: " ", period: "daily", characterIds: [ids[0]] }, NOW)).ok, false);
    assert.equal((await createItem(database.db, { label: "x".repeat(81), period: "daily", characterIds: [ids[0]] }, NOW)).ok, false);
    assert.deepEqual(await createItem(database.db, { label: "Tâche", period: "daily", characterIds: [999_999] }, NOW), { ok: false, error: "Choisissez au moins un personnage." });
  });

  test("réglage de la réinitialisation et purge des vieilles coches", async () => {
    assert.deepEqual(await loadResetRule(database.db), DEFAULT_RESET);
    await writeSettings(database.db, { resetHour: 7, resetWeekday: 2 }, NOW);
    assert.deepEqual(await loadResetRule(database.db), { hour: 7, weekday: 2 });

    const created = await createItem(database.db, { label: "Quête", period: "daily", characterIds: [ids[0]] }, NOW);
    const itemId = created.ok ? created.id : 0;
    await setCheck(database.db, itemId, ids[0], true, new Date("2026-10-01T12:00:00Z"), DEFAULT_RESET);
    await setCheck(database.db, itemId, ids[0], true, NOW, DEFAULT_RESET);
    const result = await pruneHistory(database.db, NOW);
    assert.equal(result.checklistChecks, 1);
    assert.equal(await countRows(database.db, t.checklistChecks), 1);
  });

  test("la suppression d'un personnage emporte ses liens, ses coches, sa note et ses étiquettes", async () => {
    const created = await createItem(database.db, { label: "Quête", period: "daily", characterIds: [ids[0], ids[1]] }, NOW);
    const itemId = created.ok ? created.id : 0;
    await setCheck(database.db, itemId, ids[0], true, NOW, DEFAULT_RESET);
    await saveNote(database.db, ids[0], "Note", NOW);
    await addTag(database.db, ids[0], "principal", NOW);
    const { eq } = await import("drizzle-orm");
    await database.db.delete(t.characters).where(eq(t.characters.id, ids[0]));
    assert.equal(await countRows(database.db, t.checklistItemCharacters), 1);
    assert.equal(await countRows(database.db, t.checklistChecks), 0);
    assert.equal(await countRows(database.db, t.characterNotes), 0);
    assert.equal(await countRows(database.db, t.characterTags), 0);
    assert.equal(await countRows(database.db, t.checklistItems), 1);
  });
});
