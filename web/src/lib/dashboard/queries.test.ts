import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, deleteSession, findSession } from "@/lib/auth/session";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { buildActivity } from "./activity";
import { buildLevelProgress } from "./levels";
import { getCharacterDetail, getOverview, listAccounts, listCharacters, listLevelSnapshots, listMachines, listRecentRuns, listRecentSnapshots } from "./queries";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const NOW = new Date("2026-10-04T14:00:00Z");

let database: TestDatabase;
let queries = 0;

async function sync(payload: SyncPayload, label = "PC de test") {
  const { id } = await createAgentToken(database.db, label);
  return processSync(database.db, payload, { tokenId: id, requestId: "test", now: NOW });
}

/** Document contenant `count` personnages, dérivés du premier personnage de la fixture. */
function withCharacters(count: number): SyncPayload {
  const payload = structuredClone(BASE);
  const template = payload.accounts[0].characters[0];
  payload.accounts = [payload.accounts[0]];
  payload.accounts[0].characters = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(template),
    guid: `Player-9999-${String(index).padStart(8, "0")}`,
    name: `Personnage ${index}`,
    level: index % 60,
  }));
  return payload;
}

before(async () => {
  database = await openTestDatabase();
  const original = database.pool.query.bind(database.pool);
  (database.pool as { query: unknown }).query = (...args: unknown[]) => {
    queries++;
    return (original as (...a: unknown[]) => unknown)(...args);
  };
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

describe("lecture du tableau de bord", () => {
  test("base vide : aucune erreur, aucune donnée", async () => {
    assert.deepEqual(await listCharacters(database.db), []);
    assert.deepEqual(await getOverview(database.db), { accounts: 0, machines: 0, lastSync: null });
    assert.deepEqual(await listAccounts(database.db), []);
    assert.deepEqual(await listMachines(database.db), { machines: [], pendingTokens: [] });
    assert.deepEqual(await listRecentRuns(database.db), []);
    assert.equal(await getCharacterDetail(database.db, 1), null);
  });

  test("la liste porte compte, machines et métiers de chaque personnage", async () => {
    await sync(BASE);

    const characters = await listCharacters(database.db);

    assert.equal(characters.length, 6);
    const mage = characters[0];
    assert.deepEqual(
      [mage.name, mage.class, mage.level, mage.realm, mage.moneyCopper, mage.itemLevel, mage.account.label, mage.machines.map((m) => m.label)],
      ["Élodie Brisefer", "MAGE", 25, "ClassicBetaPvE2", 80964, 16.25, "Compte 11…#1", ["PC-FIXTURE"]],
    );
    assert.deepEqual(mage.professions.map((p) => [p.name, p.rank, p.maxRank]), [
      ["Couture", 88, 150],
      ["Enchantement", 47, 75],
      ["Pêche", 1, 75],
      ["Cuisine", 20, 75],
    ]);
    assert.equal(mage.sourceLastSeenAt, new Date(1791118113_000).toISOString());
  });

  test("le nombre de requêtes ne dépend pas du nombre de personnages", async () => {
    const measure = async (count: number) => {
      await database.reset();
      await sync(withCharacters(count));
      queries = 0;
      const characters = await listCharacters(database.db);
      assert.equal(characters.length, count);
      return queries;
    };

    assert.equal(await measure(1), 3);
    assert.equal(await measure(5), 3);
    assert.equal(await measure(50), 3);
  });

  test("la fiche rassemble toutes les sections", async () => {
    await sync(BASE);
    const [{ id }] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.guid, "Player-9999-00000001"));

    const detail = (await getCharacterDetail(database.db, id))!;

    assert.equal(detail.name, "Élodie Brisefer");
    assert.equal(detail.lastMachine, "PC-FIXTURE");
    assert.deepEqual(
      [detail.professions.length, detail.equipment.length, detail.reputations.length, detail.currencies.length, detail.bags.length, detail.bank.length, detail.snapshots.length],
      [4, 14, 10, 1, 54, 40, 1],
    );
    assert.equal(detail.stats?.intellect, 116);
    // Le nom des objets vient du référentiel partagé.
    assert.ok(detail.bags.every((item) => item.name !== null));
  });

  test("comptes et machines sont agrégés", async () => {
    const payload = structuredClone(BASE);
    payload.accounts[0].folderName = "111111111#1";
    await sync(payload);

    const accounts = await listAccounts(database.db);
    assert.deepEqual(accounts.map((a) => [a.label, a.folderName, a.characters, a.maxLevel, a.machines.map((m) => m.label)]), [
      ["Compte 11…#1", "111111111#1", 4, 25, ["PC-FIXTURE"]],
      ["Compte 22…#1", null, 2, 13, ["PC-FIXTURE"]],
    ]);
    assert.equal(accounts[0].totalCopper, BASE.accounts[0].characters.reduce((total, c) => total + (c.moneyCopper ?? 0), 0));

    const { machines, pendingTokens } = await listMachines(database.db);
    assert.deepEqual(machines.map((m) => [m.label, m.accounts, m.characters, m.tokens.length]), [["PC-FIXTURE", 2, 6, 1]]);
    assert.deepEqual(pendingTokens, []);

    const overview = await getOverview(database.db);
    assert.deepEqual([overview.accounts, overview.machines, overview.lastSync?.machine], [2, 1, "PC-FIXTURE"]);
    assert.equal((await listRecentRuns(database.db)).length, 1);
  });

  test("le journal porte les avertissements de chaque synchronisation, dix au plus, et leur nombre", async () => {
    const payload = structuredClone(BASE);
    payload.accounts[0].warnings = Array.from({ length: 12 }, (_, i) => `avertissement ${i + 1}`);
    await sync(payload);

    const [run] = await listRecentRuns(database.db);

    assert.deepEqual([run.status, run.errorsCount, run.errors.length], ["partial", 12, 10]);
    assert.deepEqual(run.errors[0], { code: "agent_warning", message: "avertissement 1" });
  });

  test("un nom d'affichage personnalisé remplace le libellé par défaut", async () => {
    await sync(BASE);
    await database.db.update(t.wowAccounts).set({ displayName: "Compte principal" }).where(eq(t.wowAccounts.folderHint, "11…#1"));
    await database.db.update(t.machines).set({ displayName: "PC du salon" });

    const characters = await listCharacters(database.db);

    assert.equal(characters[0].account.label, "Compte principal");
    assert.deepEqual(characters[0].machines.map((m) => m.label), ["PC du salon"]);
  });

  test("l'activité lit les relevés de la période et, par personnage, le dernier d'avant", async () => {
    await sync(BASE);
    const [first, second] = await database.db.select({ id: t.characters.id, name: t.characters.name }).from(t.characters).orderBy(t.characters.id);
    await database.db.delete(t.characterSnapshots);
    const at = (characterId: number, capturedAt: string, level: number) => ({
      characterId,
      capturedAt: new Date(capturedAt),
      snapshotHash: `${characterId}-${capturedAt}`,
      level,
      data: {},
    });
    await database.db.insert(t.characterSnapshots).values([
      at(first.id, "2026-06-01T10:00:00Z", 10),
      at(first.id, "2026-08-20T10:00:00Z", 15),
      at(first.id, "2026-09-20T10:00:00Z", 20),
      at(first.id, "2026-10-01T10:00:00Z", 21),
      // Aucun relevé dans la période : son dernier relevé d'avant est lu, et ne donnera aucun changement.
      at(second.id, "2026-07-01T10:00:00Z", 5),
    ]);

    queries = 0;
    const snapshots = await listRecentSnapshots(database.db, new Date("2026-09-04T14:00:00Z"));

    assert.equal(queries, 1);
    assert.deepEqual(
      snapshots.map((snapshot) => [snapshot.character.name, snapshot.level]),
      [
        [first.name, 15],
        [first.name, 20],
        [first.name, 21],
        [second.name, 5],
      ],
    );
    assert.equal(snapshots[0].character.account, "Compte 11…#1");
    assert.deepEqual(
      buildActivity(snapshots, new Date("2026-09-04T14:00:00Z")).flatMap((day) => day.entries.map((entry) => entry.changes[0].text)),
      ["Niveau 20 → 21", "Niveau 15 → 20"],
    );
  });

  test("les niveaux lisent les relevés de la période, le dernier d'avant, et tout l'historique sans date de début", async () => {
    await sync(BASE);
    const [first, second] = await database.db.select({ id: t.characters.id, name: t.characters.name }).from(t.characters).orderBy(t.characters.id);
    await database.db.delete(t.characterSnapshots);
    const at = (characterId: number, capturedAt: string, level: number | null, xp: number | null = null) => ({
      characterId,
      capturedAt: new Date(capturedAt),
      snapshotHash: `${characterId}-${capturedAt}`,
      level,
      xp,
      xpMax: xp === null ? null : 1000,
      data: {},
    });
    await database.db.insert(t.characterSnapshots).values([
      at(first.id, "2026-06-01T10:00:00Z", 10),
      at(first.id, "2026-08-20T10:00:00Z", 15, 250),
      at(first.id, "2026-09-20T10:00:00Z", 20, 500),
      // Niveau inconnu : rien à tracer.
      at(first.id, "2026-09-25T10:00:00Z", null),
      at(second.id, "2026-07-01T10:00:00Z", 5),
    ]);
    const since = new Date("2026-09-04T14:00:00Z");

    queries = 0;
    const rows = await listLevelSnapshots(database.db, since);

    assert.equal(queries, 1);
    assert.deepEqual(
      rows.map((row) => [row.name, row.level, row.xp, row.xpMax]),
      [
        [first.name, 15, 250, 1000],
        [first.name, 20, 500, 1000],
        [second.name, 5, null, null],
      ],
    );
    assert.equal(rows[0].account, "Compte 11…#1");
    assert.deepEqual(
      buildLevelProgress(rows, since, NOW).series.map((entry) => [entry.name, entry.startLevel, entry.endLevel, entry.gained]),
      [
        [first.name, 15, 20, 5],
        [second.name, 5, 5, 0],
      ],
    );

    assert.deepEqual((await listLevelSnapshots(database.db, null)).map((row) => row.level), [10, 15, 20, 5]);
  });
});

describe("accès au tableau de bord", () => {
  test("le mot de passe est haché et vérifié", async () => {
    const hash = await hashPassword("un mot de passe très long");

    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!hash.includes("mot de passe"));
    assert.equal(await verifyPassword("un mot de passe très long", hash), true);
    assert.equal(await verifyPassword("un mot de passe très lonG", hash), false);
    assert.equal(await verifyPassword("x", "format-inconnu"), false);
    assert.equal(await verifyAgainstDummy("n'importe quoi"), false);
    assert.notEqual(hash, await hashPassword("un mot de passe très long"));
  });

  test("une session est valable jusqu'à son expiration, sa suppression ou la désactivation du compte", async () => {
    const [user] = await database.db.insert(t.adminUsers).values({ email: "moi@exemple.test", passwordHash: "x" }).returning();

    const token = await createSession(database.db, user.id, NOW);

    const [stored] = await database.db.select().from(t.sessions);
    assert.notEqual(stored.tokenHash, token);
    assert.deepEqual(await findSession(database.db, token, NOW), { userId: user.id, email: "moi@exemple.test" });
    assert.equal(await findSession(database.db, "jeton-inconnu", NOW), null);
    assert.equal(await findSession(database.db, undefined, NOW), null);
    assert.equal(await findSession(database.db, token, new Date(NOW.getTime() + 31 * 24 * 3600 * 1000)), null);

    await database.db.update(t.adminUsers).set({ active: false });
    assert.equal(await findSession(database.db, token, NOW), null);
    await database.db.update(t.adminUsers).set({ active: true });

    await deleteSession(database.db, token);
    assert.equal(await findSession(database.db, token, NOW), null);
  });
});
