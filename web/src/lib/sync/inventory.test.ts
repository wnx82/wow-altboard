import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { loadInventory } from "@/lib/dashboard/inventory";
import { processSync } from "./process";
import { syncPayloadSchema, type AccountPayload, type SyncPayload } from "./schema";

// Document produit par l'agent 0.8.0 à partir des fixtures account-four-characters.lua et
// syndicator-small.lua (voir tests/fixtures/README.md).
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/baganator-account.json"), "utf8"),
);
const MAGE = "Player-9999-00000001";
const NOW = new Date("2026-11-12T18:00:00Z");

let database: TestDatabase;
let tokenId: number;

const clone = (): SyncPayload => structuredClone(BASE);
const account = (payload: SyncPayload): AccountPayload => payload.accounts[0];
const baganator = (payload: SyncPayload) => account(payload).baganator!;
const count = (table: Parameters<typeof countRows>[1]) => countRows(database.db, table);
const sync = (payload: SyncPayload, now = NOW) => processSync(database.db, payload, { tokenId, requestId: "test", now });
const shiftFile = (payload: SyncPayload, seconds: number) => {
  const file = baganator(payload).file;
  file.modifiedAt = new Date(new Date(file.modifiedAt).getTime() + seconds * 1000).toISOString();
};

async function holdingsOf(guid: string) {
  return database.db
    .select({ location: t.characterHoldings.location, itemKey: t.characterHoldings.itemKey, quantity: t.characterHoldings.quantity, expiresAt: t.characterHoldings.expiresAt })
    .from(t.characterHoldings)
    .innerJoin(t.characters, eq(t.characters.id, t.characterHoldings.characterId))
    .where(eq(t.characters.guid, guid))
    .orderBy(asc(t.characterHoldings.location), asc(t.characterHoldings.itemKey));
}

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  tokenId = (await createAgentToken(database.db, "test")).id;
});

describe("Baganator : courrier, enchères et banques de guilde", () => {
  test("le document de l'agent est accepté et rattaché aux personnages", async () => {
    assert.equal(syncPayloadSchema.safeParse(BASE).success, true);
    await sync(clone());

    assert.deepEqual(await holdingsOf(MAGE), [
      { location: "auctions", itemKey: "20576", quantity: 1, expiresAt: new Date(1794091265 * 1000) },
      { location: "mail", itemKey: "15210:1017", quantity: 1, expiresAt: new Date(1796999134 * 1000) },
      { location: "mail", itemKey: "249427", quantity: 12, expiresAt: new Date(1796999134 * 1000) },
      // Deux courriers du même objet : additionnés par l'agent, échéance la plus proche.
      { location: "mail", itemKey: "249428", quantity: 5, expiresAt: new Date(1796500000 * 1000) },
    ]);
    assert.equal(await count(t.characterHoldingSources), 2);
    // Les objets que seul Baganator cite sont décrits, nom compris.
    const [item] = await database.db.select().from(t.items).where(eq(t.items.itemKey, "15210:1017"));
    assert.equal(item.name, "Épée large de l'ours");
    assert.equal(item.suffixId, 1017);

    const [guild] = await database.db.select().from(t.guildBanks);
    assert.deepEqual([guild.name, guild.realm, guild.moneyCopper, guild.tabNames], ["Ordre Fictif", "ClassicBetaPvE2", 4699, { "1": "Composants" }]);
    const items = await database.db.select({ tab: t.guildBankItems.tab, itemKey: t.guildBankItems.itemKey, quantity: t.guildBankItems.quantity }).from(t.guildBankItems);
    assert.deepEqual(items, [{ tab: 1, itemKey: "2318", quantity: 25 }]);
    // Les sacs et la banque restent ceux d'AltBoard : aucune ligne de courrier n'y entre.
    const locations = await database.db.selectDistinct({ location: t.characterItems.location }).from(t.characterItems);
    assert.deepEqual(locations.map((l) => l.location).sort(), ["bags", "bank"]);
  });

  test("le même relevé envoyé dix fois ne change rien", async () => {
    await sync(clone());
    const [source] = await database.db.select().from(t.characterHoldingSources).limit(1);
    for (let i = 0; i < 10; i++) await sync(clone(), new Date(NOW.getTime() + (i + 1) * 60_000));

    assert.equal(await count(t.characterHoldings), 4);
    assert.equal(await count(t.guildBanks), 1);
    assert.equal(await count(t.guildBankItems), 1);
    const [again] = await database.db.select().from(t.characterHoldingSources).where(eq(t.characterHoldingSources.characterId, source.characterId));
    assert.equal(again.updatedAt.getTime(), source.updatedAt.getTime());
  });

  test("un courrier retiré disparaît ; un fichier plus ancien ne change rien", async () => {
    await sync(clone());

    const older = clone();
    shiftFile(older, -3600);
    baganator(older).characters[0].mail = [];
    await sync(older);
    assert.equal((await holdingsOf(MAGE)).filter((h) => h.location === "mail").length, 3);

    const newer = clone();
    shiftFile(newer, 3600);
    baganator(newer).characters[0].mail = [];
    baganator(newer).guilds[0].tabs[0].items = [{ key: "2589", count: 3 }];
    await sync(newer);
    assert.deepEqual((await holdingsOf(MAGE)).map((h) => h.location), ["auctions"]);
    const items = await database.db.select({ itemKey: t.guildBankItems.itemKey, quantity: t.guildBankItems.quantity }).from(t.guildBankItems);
    assert.deepEqual(items, [{ itemKey: "2589", quantity: 3 }]);
  });

  test("ni personnage inconnu d'AltBoard, ni guilde d'un royaume sans personnage du compte", async () => {
    const payload = clone();
    baganator(payload).characters.push({ guid: "Player-9999-0000FFFF", mail: [{ key: "2589", count: 1 }], auctions: [] });
    baganator(payload).guilds.push({ name: "Ailleurs", realm: "AutreRoyaume", moneyCopper: 10, tabs: [] });
    await sync(payload);

    assert.equal(await count(t.characterHoldingSources), 2);
    assert.deepEqual((await database.db.select({ name: t.guildBanks.name }).from(t.guildBanks)).map((g) => g.name), ["Ordre Fictif"]);
  });

  test("une banque de guilde dont le royaume n'a plus de personnage du compte disparaît", async () => {
    await sync(clone());
    // Comme après une réinitialisation : la guilde gardée est sur un royaume sans personnage du compte.
    await database.db.update(t.guildBanks).set({ realm: "RoyaumeDisparu" });
    await sync(clone(), new Date(NOW.getTime() + 60_000));

    assert.deepEqual(
      (await database.db.select({ realm: t.guildBanks.realm }).from(t.guildBanks)).map((g) => g.realm),
      ["ClassicBetaPvE2"],
    );
  });

  test("la page Inventaires réunit sacs, banque, courrier, enchères et banques de guilde", async () => {
    await sync(clone());
    const data = await loadInventory(database.db);

    const mage = data.characters.find((character) => character.name === "Élodie Brisefer")!;
    assert.notEqual(mage.seen.mail, null);
    const places = new Set(data.entries.filter((entry) => entry.characterId === mage.id).map((entry) => entry.location));
    assert.deepEqual([...places].sort(), ["auctions", "bags", "bank", "mail"]);
    assert.deepEqual(
      data.guilds.map((guild) => [guild.name, guild.tabs.map((tab) => [tab.index, tab.name, tab.items])]),
      [["Ordre Fictif", [[1, "Composants", [{ itemKey: "2318", quantity: 25 }]]]]],
    );
    assert.equal(data.items["15210:1017"].name, "Épée large de l'ours");

    // Royaume sans personnage du compte : la guilde n'est plus montrée, avant même sa suppression.
    await database.db.update(t.guildBanks).set({ realm: "RoyaumeDisparu" });
    assert.deepEqual((await loadInventory(database.db)).guilds, []);
  });

  test("un agent antérieur à 0.8.0, sans bloc Baganator, laisse le relevé en place", async () => {
    await sync(clone());
    const payload = clone();
    delete account(payload).baganator;
    await sync(payload, new Date(NOW.getTime() + 60_000));

    assert.equal(await count(t.characterHoldings), 4);
    assert.equal(await count(t.guildBanks), 1);
  });

  test("supprimer le compte supprime ses banques de guilde, supprimer un personnage son courrier", async () => {
    await sync(clone());
    await database.db.delete(t.characters).where(eq(t.characters.guid, MAGE));
    assert.equal(await count(t.characterHoldings), 0);

    await database.db.delete(t.characters);
    await database.db.delete(t.machineAccounts);
    await database.db.delete(t.marketImports);
    await database.db.delete(t.wowAccounts);
    assert.equal(await count(t.guildBanks), 0);
    assert.equal(await count(t.guildBankItems), 0);
  });
});
