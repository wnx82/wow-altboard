import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { setAccountFavorite } from "./favorite-account";

// Deux comptes, six personnages sur un même royaume.
const TWO_ACCOUNTS: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const NOW = new Date("2026-11-11T18:00:00Z");

let database: TestDatabase;

const accounts = () =>
  database.db
    .select({ id: t.wowAccounts.id, featured: t.wowAccounts.featured, updatedAt: t.wowAccounts.updatedAt })
    .from(t.wowAccounts)
    .orderBy(asc(t.wowAccounts.id));

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  const { id: tokenId } = await createAgentToken(database.db, "PC-test");
  await processSync(database.db, structuredClone(TWO_ACCOUNTS), { tokenId, requestId: "test", now: new Date("2026-11-10T12:00:00Z") });
});

describe("setAccountFavorite", () => {
  test("ajoute un compte aux favoris puis l'en retire, sans toucher aux autres", async () => {
    const [first, second] = await accounts();

    assert.equal(await setAccountFavorite(database.db, second.id, true, NOW), true);
    assert.deepEqual(
      (await accounts()).map((account) => account.featured),
      [false, true],
    );
    assert.equal((await accounts())[1].updatedAt.toISOString(), NOW.toISOString());
    assert.equal((await accounts())[0].updatedAt.toISOString(), first.updatedAt.toISOString());

    assert.equal(await setAccountFavorite(database.db, second.id, false, NOW), true);
    assert.ok((await accounts()).every((account) => !account.featured));
  });

  test("répète sans erreur un état déjà en place", async () => {
    const [first] = await accounts();
    assert.equal(await setAccountFavorite(database.db, first.id, true, NOW), true);
    assert.equal(await setAccountFavorite(database.db, first.id, true, NOW), true);
    assert.equal((await accounts())[0].featured, true);
  });

  test("signale un compte qui n'existe plus", async () => {
    const unchanged = await accounts();
    assert.equal(await setAccountFavorite(database.db, 999_999, true, NOW), false);
    assert.deepEqual(await accounts(), unchanged);
  });
});
