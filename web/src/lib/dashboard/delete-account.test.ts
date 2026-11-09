import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq, isNull } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { deleteAccount } from "./delete-account";

const fixture = (name: string): SyncPayload =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../../tests/fixtures/payloads/${name}.json`), "utf8"));
// Deux comptes, six personnages sur un même royaume.
const TWO_ACCOUNTS = fixture("two-accounts");
// Un compte avec des relevés Auctionator.
const ECONOMY = fixture("economy-account");
const NOW = new Date("2026-11-06T18:00:00Z");

let database: TestDatabase;
let tokenId: number;

const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);
const sync = (payload: SyncPayload) => processSync(database.db, structuredClone(payload), { tokenId, requestId: "test", now: NOW });
const accountId = async (accountKey: string) => {
  const [row] = await database.db.select({ id: t.wowAccounts.id }).from(t.wowAccounts).where(eq(t.wowAccounts.accountKey, accountKey));
  return row.id;
};

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

describe("suppression d'un compte", () => {
  test("supprime le compte, ses personnages et leur historique, sans toucher à l'autre compte", async () => {
    await sync(TWO_ACCOUNTS);
    const [first, second] = TWO_ACCOUNTS.accounts;
    const id = await accountId(first.accountKey);

    const result = await deleteAccount(database.db, id);

    assert.deepEqual(result, { characters: first.characters.length, marketImports: 0 });
    const guids = (await database.db.select({ guid: t.characters.guid }).from(t.characters)).map((row) => row.guid).sort();
    assert.deepEqual(guids, second.characters.map((character) => character.guid).sort());
    assert.deepEqual(await database.db.select({ accountKey: t.wowAccounts.accountKey }).from(t.wowAccounts), [{ accountKey: second.accountKey }]);
    assert.equal(await count(t.machineAccounts), 1);
    // Le royaume sert encore à l'autre compte ; la machine, son jeton et le journal restent.
    assert.deepEqual([await count(t.realms), await count(t.machines), await count(t.agentTokens), await count(t.syncRuns)], [1, 1, 1, 1]);
  });

  test("sans personnage restant, l'historique et le royaume disparaissent aussi", async () => {
    await sync(TWO_ACCOUNTS);
    for (const account of TWO_ACCOUNTS.accounts) await deleteAccount(database.db, await accountId(account.accountKey));

    for (const table of [t.wowAccounts, t.machineAccounts, t.characters, t.characterMachines, t.characterSnapshots, t.characterItems, t.realms]) {
      assert.equal(await count(table), 0);
    }
    assert.ok((await count(t.items)) > 0);
  });

  test("supprime les imports de marché du compte, garde les prix relevés", async () => {
    await sync(ECONOMY);
    const days = await count(t.marketItemDays);
    assert.ok(days > 0 && (await count(t.marketImports)) === 1);

    const result = await deleteAccount(database.db, await accountId(ECONOMY.accounts[0].accountKey));

    assert.equal(result?.marketImports, 1);
    assert.equal(await count(t.marketImports), 0);
    assert.equal(await count(t.marketItemDays), days);
    const latest = await count(t.marketItemLatest);
    assert.ok(latest > 0);
    assert.equal((await database.db.select().from(t.marketItemLatest).where(isNull(t.marketItemLatest.importId))).length, latest);
  });

  test("un compte inconnu ne supprime rien", async () => {
    await sync(TWO_ACCOUNTS);

    assert.equal(await deleteAccount(database.db, 999_999), null);

    assert.deepEqual([await count(t.wowAccounts), await count(t.characters)], [2, TWO_ACCOUNTS.accounts.flatMap((account) => account.characters).length]);
  });

  test("un PC qui renvoie le dossier recrée le compte", async () => {
    await sync(TWO_ACCOUNTS);
    const [first] = TWO_ACCOUNTS.accounts;
    await deleteAccount(database.db, await accountId(first.accountKey));

    await sync(TWO_ACCOUNTS);

    assert.equal(await count(t.wowAccounts), 2);
    assert.ok(await accountId(first.accountKey));
  });
});
