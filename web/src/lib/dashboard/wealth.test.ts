import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InventoryCharacter, InventoryData } from "./inventory";
import { buildWealth } from "./wealth";

const NOW = new Date("2026-11-14T12:00:00Z");
const character = (id: number, name: string, accountId: number): InventoryCharacter => ({
  id,
  name,
  realm: "Royaume",
  class: "MAGE",
  level: 60,
  account: { id: accountId, label: `Compte ${accountId}`, featured: false },
  seen: { bags: null, bank: null, mail: null, auctions: null },
});

describe("patrimoine", () => {
  test("or et objets par endroit, comptes avec leurs banques de guilde, échus et sans prix exclus", () => {
    const data: Pick<InventoryData, "characters" | "entries" | "guilds" | "prices" | "market"> = {
      characters: [character(1, "Ada", 10), character(2, "Bob", 10), character(3, "Cid", 20)],
      entries: [
        { characterId: 1, location: "bags", itemKey: "a", quantity: 2, expiresAt: null },
        { characterId: 1, location: "bank", itemKey: "b", quantity: 1, expiresAt: null },
        // Courrier échu : renvoyé ou supprimé, il ne compte plus.
        { characterId: 1, location: "mail", itemKey: "a", quantity: 5, expiresAt: "2026-11-13T00:00:00Z" },
        { characterId: 2, location: "auctions", itemKey: "a", quantity: 1, expiresAt: "2026-11-15T00:00:00Z" },
        // Sans prix connu : compté pour rien, mais signalé.
        { characterId: 3, location: "bags", itemKey: "inconnu", quantity: 3, expiresAt: null },
      ],
      guilds: [
        {
          id: 7,
          name: "Guilde",
          realm: "Royaume",
          accountId: 20,
          accountLabel: "Compte 20",
          moneyCopper: 1_000,
          seenAt: NOW.toISOString(),
          tabs: [{ index: 1, name: null, items: [{ itemKey: "b", quantity: 2 }] }],
        },
      ],
      prices: { a: 100, b: 500 },
      market: { id: 1, label: "PvE" },
    };
    const wealth = buildWealth(data, new Map([[1, 10_000], [2, 50]]), NOW);

    assert.deepEqual(
      wealth.lines.map((line) => [line.character.name, line.gold, line.places, line.total, line.unpriced]),
      [
        ["Ada", 10_000, { bags: 200, bank: 500, mail: 0, auctions: 0 }, 10_700, 0],
        ["Bob", 50, { bags: 0, bank: 0, mail: 0, auctions: 100 }, 150, 0],
        // Or inconnu : zéro.
        ["Cid", 0, { bags: 0, bank: 0, mail: 0, auctions: 0 }, 0, 3],
      ],
    );
    assert.deepEqual(
      wealth.accounts.map((account) => [account.account.label, account.characters, account.gold, account.items, account.guilds, account.total, account.unpriced]),
      [
        ["Compte 10", 2, 10_050, 800, 0, 10_850, 0],
        ["Compte 20", 1, 0, 0, 2_000, 2_000, 3],
      ],
    );
    assert.deepEqual(wealth.totals, { gold: 10_050, items: 800, guilds: 2_000, total: 12_850, unpriced: 3 });
  });

  test("aucun prix reçu : seul l'or compte", () => {
    const wealth = buildWealth(
      {
        characters: [character(1, "Ada", 10)],
        entries: [{ characterId: 1, location: "bags", itemKey: "a", quantity: 2, expiresAt: null }],
        guilds: [],
        prices: {},
        market: null,
      },
      new Map([[1, 300]]),
      NOW,
    );
    assert.deepEqual(wealth.totals, { gold: 300, items: 0, guilds: 0, total: 300, unpriced: 2 });
  });
});
