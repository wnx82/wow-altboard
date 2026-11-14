import { asc } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { loadInventory, type InventoryData, type InventoryLocation } from "./inventory";
import { holdingsValue } from "./inventory-view";

// Patrimoine : l'or de chaque personnage et la valeur au marché de ce qu'il possède (sacs, banque,
// courrier, ventes en cours), additionnés par compte avec les banques de guilde. Un courrier ou une
// vente échus ne comptent pas, comme dans Inventaires.

export const WEALTH_PLACES: readonly InventoryLocation[] = ["bags", "bank", "mail", "auctions"];

export type WealthLine = {
  character: InventoryData["characters"][number];
  gold: number;
  /** Valeur au marché par endroit, en pièces de cuivre. */
  places: Record<InventoryLocation, number>;
  items: number;
  total: number;
  /** Exemplaires sans prix connu, comptés pour rien. */
  unpriced: number;
};

export type AccountWealth = {
  account: { id: number; label: string };
  characters: number;
  gold: number;
  items: number;
  /** Or et objets des banques de guilde relevées depuis ce compte. */
  guilds: number;
  total: number;
  unpriced: number;
};

export type Wealth = {
  lines: WealthLine[];
  accounts: AccountWealth[];
  totals: { gold: number; items: number; guilds: number; total: number; unpriced: number };
  market: InventoryData["market"];
};

/** Or de chaque personnage, en pièces de cuivre ; un personnage absent n'en a pas de connu. */
export type MoneyById = ReadonlyMap<number, number | null>;

export function buildWealth(data: Pick<InventoryData, "characters" | "entries" | "guilds" | "prices" | "market">, money: MoneyById, now: Date): Wealth {
  const byCharacter = Map.groupBy(data.entries, (entry) => entry.characterId);
  const lines = data.characters.map<WealthLine>((character) => {
    const entries = byCharacter.get(character.id) ?? [];
    const places = { bags: 0, bank: 0, mail: 0, auctions: 0 } satisfies Record<InventoryLocation, number>;
    let unpriced = 0;
    for (const place of WEALTH_PLACES) {
      const result = holdingsValue(
        entries.filter((entry) => entry.location === place),
        data.prices,
        now,
      );
      places[place] = result.value;
      unpriced += result.unpriced;
    }
    const gold = money.get(character.id) ?? 0;
    const items = WEALTH_PLACES.reduce((sum, place) => sum + places[place], 0);
    return { character, gold, places, items, total: gold + items, unpriced };
  });
  lines.sort((a, b) => b.total - a.total || a.character.name.localeCompare(b.character.name, "fr"));

  const accounts = new Map<number, AccountWealth>();
  const accountOf = (id: number, label: string) => {
    let account = accounts.get(id);
    if (!account) {
      account = { account: { id, label }, characters: 0, gold: 0, items: 0, guilds: 0, total: 0, unpriced: 0 };
      accounts.set(id, account);
    }
    return account;
  };
  for (const line of lines) {
    const account = accountOf(line.character.account.id, line.character.account.label);
    account.characters += 1;
    account.gold += line.gold;
    account.items += line.items;
    account.unpriced += line.unpriced;
  }
  for (const guild of data.guilds) {
    const account = accountOf(guild.accountId, guild.accountLabel);
    const result = holdingsValue(
      guild.tabs.flatMap((tab) => tab.items),
      data.prices,
      now,
    );
    account.guilds += (guild.moneyCopper ?? 0) + result.value;
    account.unpriced += result.unpriced;
  }
  for (const account of accounts.values()) account.total = account.gold + account.items + account.guilds;
  const sortedAccounts = [...accounts.values()].sort((a, b) => b.total - a.total || a.account.label.localeCompare(b.account.label, "fr"));

  const totals = { gold: 0, items: 0, guilds: 0, total: 0, unpriced: 0 };
  for (const account of sortedAccounts) {
    totals.gold += account.gold;
    totals.items += account.items;
    totals.guilds += account.guilds;
    totals.total += account.total;
    totals.unpriced += account.unpriced;
  }
  return { lines, accounts: sortedAccounts, totals, market: data.market };
}

export async function loadWealth(db: Database, now: Date): Promise<Wealth> {
  const [data, money] = await Promise.all([
    loadInventory(db, now),
    db.select({ id: t.characters.id, moneyCopper: t.characters.moneyCopper }).from(t.characters).orderBy(asc(t.characters.id)),
  ]);
  return buildWealth(data, new Map(money.map((row) => [row.id, row.moneyCopper])), now);
}
