import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync, type SyncResult } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { characterSummary, resetCharacters } from "./reset";
import { readSettings, writeSettings } from "./store";

// Document produit par l'agent réel à partir des fixtures AltBoard.lua anonymisées : six
// personnages de la bêta, sur deux comptes et un royaume.
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const ALL = BASE.accounts.flatMap((account) => account.characters);
const NEWEST = ALL.reduce((latest, character) => (character.lastSeen > latest.lastSeen ? character : latest));
const SYNCED_AT = new Date("2026-10-04T14:00:00Z");
// Sortie officielle : tous les personnages de la fixture ont été vus en jeu avant.
const RELEASE = new Date("2026-11-04T16:00:00Z");

let database: TestDatabase;
let tokenId: number;
let requests = 0;

const clone = (): SyncPayload => structuredClone(BASE);
const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);

function sync(payload: SyncPayload, now = SYNCED_AT): Promise<SyncResult> {
  return processSync(database.db, payload, { tokenId, requestId: `test-${++requests}`, now });
}

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  tokenId = (await createAgentToken(database.db, "PC de test")).id;
});

describe("réglages", () => {
  test("sans ligne en base, tout est par défaut", async () => {
    assert.deepEqual(await readSettings(database.db), {
      statusAuthTargets: null,
      statusGameTargets: null,
      statusLabel: null,
      charactersCutoffAt: null,
      charactersResetAt: null,
      marketHistoryFrom: null,
      auctionCutPercent: null,
      resetHour: null,
      resetWeekday: null,
    });
  });

  test("une écriture ne touche que les réglages fournis, sur une seule ligne", async () => {
    await writeSettings(database.db, { statusAuthTargets: "test.actual.battle.net:1119", statusGameTargets: "", statusLabel: "Bêta" }, SYNCED_AT);
    await writeSettings(database.db, { charactersCutoffAt: RELEASE, charactersResetAt: RELEASE }, RELEASE);
    await writeSettings(database.db, { statusAuthTargets: null }, RELEASE);

    assert.deepEqual(await readSettings(database.db), {
      statusAuthTargets: null,
      statusGameTargets: "",
      statusLabel: "Bêta",
      charactersCutoffAt: RELEASE,
      charactersResetAt: RELEASE,
      marketHistoryFrom: null,
      auctionCutPercent: null,
      resetHour: null,
      resetWeekday: null,
    });
    assert.equal(await count(t.appSettings), 1);
  });

  test("la table n'admet qu'une ligne", async () => {
    await assert.rejects(Promise.resolve(database.db.insert(t.appSettings).values({ id: 2 })), (error: unknown) => {
      const cause = (error as { cause?: { constraint?: string } }).cause ?? (error as { constraint?: string });
      assert.equal(cause.constraint, "app_settings_single_row_check");
      return true;
    });
  });
});

describe("réinitialisation des personnages", () => {
  test("supprime les personnages et tout leur historique, garde comptes, machines et journal", async () => {
    await sync(clone());
    assert.equal(await count(t.characters), ALL.length);
    assert.ok((await count(t.characterSnapshots)) > 0 && (await count(t.characterEquipment)) > 0 && (await count(t.characterItems)) > 0);

    const result = await resetCharacters(database.db, RELEASE, RELEASE);

    assert.deepEqual(result, { deleted: ALL.length, kept: 0 });
    for (const table of [
      t.characters,
      t.characterMachines,
      t.characterStats,
      t.characterProfessions,
      t.characterEquipment,
      t.characterReputations,
      t.characterCurrencies,
      t.characterItems,
      t.characterPlaytime,
      t.characterLevelTimes,
      t.characterSessions,
      t.characterSnapshots,
      t.realms,
    ]) {
      assert.equal(await count(table), 0);
    }
    assert.deepEqual([await count(t.wowAccounts), await count(t.machines), await count(t.agentTokens), await count(t.syncRuns)], [2, 1, 1, 1]);
    assert.ok((await count(t.items)) > 0);
    const settings = await readSettings(database.db);
    assert.deepEqual([settings.charactersCutoffAt, settings.charactersResetAt], [RELEASE, RELEASE]);
  });

  test("le fichier de la bêta, renvoyé après coup, ne recrée aucun personnage", async () => {
    await sync(clone());
    await resetCharacters(database.db, RELEASE, RELEASE);

    const result = await sync(clone(), new Date("2026-11-05T09:00:00Z"));

    assert.deepEqual(
      [result.charactersReceived, result.charactersCreated, result.charactersUpdated, result.charactersUnchanged, result.charactersStale],
      [ALL.length, 0, 0, 0, ALL.length],
    );
    assert.deepEqual([await count(t.characters), await count(t.realms), await count(t.characterSnapshots)], [0, 0, 0]);
  });

  test("un personnage joué après la date limite est accepté ; connu, il suit ensuite les règles habituelles", async () => {
    await sync(clone());
    await resetCharacters(database.db, RELEASE, RELEASE);
    const played = clone();
    const live = played.accounts.flatMap((account) => account.characters).find((character) => character.guid === NEWEST.guid)!;
    Object.assign(live, { lastSeen: RELEASE.getTime() / 1000 + 3_600, level: 3 });

    const first = await sync(played, new Date("2026-11-04T18:00:00Z"));
    // Un autre PC détient encore le fichier d'avant la sortie : le personnage connu n'est ni
    // supprimé ni régressé, les autres restent ignorés.
    const second = await sync(clone(), new Date("2026-11-04T19:00:00Z"));

    assert.deepEqual([first.charactersCreated, first.charactersStale], [1, ALL.length - 1]);
    assert.deepEqual([second.charactersCreated, second.charactersUpdated, second.charactersStale], [0, 0, ALL.length]);
    const stored = await database.db.select({ guid: t.characters.guid, level: t.characters.level }).from(t.characters);
    assert.deepEqual(stored, [{ guid: NEWEST.guid, level: 3 }]);
    assert.equal(await count(t.realms), 1);
  });

  test("une date limite garde les personnages vus en jeu depuis", async () => {
    await sync(clone());
    const cutoff = new Date(NEWEST.lastSeen * 1000);

    const result = await resetCharacters(database.db, cutoff, RELEASE);

    assert.deepEqual(result, { deleted: ALL.length - 1, kept: 1 });
    const stored = await database.db.select({ guid: t.characters.guid }).from(t.characters);
    assert.deepEqual(stored, [{ guid: NEWEST.guid }]);
    // Son royaume a encore un personnage : il reste.
    assert.equal(await count(t.realms), 1);
    assert.ok((await count(t.characterSnapshots)) > 0);
  });

  test("sans réinitialisation, aucun personnage n'est ignoré", async () => {
    const result = await sync(clone());

    assert.deepEqual([result.charactersCreated, result.charactersStale], [ALL.length, 0]);
  });

  test("le résumé dit ce que la réinitialisation toucherait", async () => {
    assert.deepEqual(await characterSummary(database.db), { count: 0, oldestSeenAt: null, newestSeenAt: null });

    await sync(clone());

    const oldest = Math.min(...ALL.map((character) => character.lastSeen));
    assert.deepEqual(await characterSummary(database.db), {
      count: ALL.length,
      oldestSeenAt: new Date(oldest * 1000),
      newestSeenAt: new Date(NEWEST.lastSeen * 1000),
    });
  });
});
