import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { catalogId, loadItemNames } from "@/lib/economy/item-names";
import { loadMarketValues } from "@/lib/economy/load";
import { accountLabel } from "./queries";

// Page Inventaires : le contenu des sacs, de la banque (AltBoard), du courrier, des enchères en
// cours et des banques de guilde (Baganator) de tous les personnages, en un seul chargement.

export type InventoryLocation = "bags" | "bank" | "mail" | "auctions";

export type InventoryCharacter = {
  id: number;
  name: string;
  realm: string;
  class: string | null;
  level: number | null;
  account: { id: number; label: string; featured: boolean };
  /** Date de chaque relevé (ISO) ; null quand il n'a jamais eu lieu. */
  seen: Record<InventoryLocation, string | null>;
};

/** Un objet chez un personnage, à un endroit. expiresAt (ISO) : courrier et enchères seulement. */
export type InventoryEntry = { characterId: number; location: InventoryLocation; itemKey: string; quantity: number; expiresAt: string | null };

export type InventoryGuild = {
  id: number;
  name: string;
  realm: string;
  accountId: number;
  accountLabel: string;
  moneyCopper: number | null;
  seenAt: string;
  tabs: { index: number; name: string | null; items: { itemKey: string; quantity: number }[] }[];
};

/** icon : nom de fichier de l'icône (« inv_scroll_03 »), null quand il est inconnu. */
export type InventoryItemInfo = { name: string | null; quality: number | null; icon: string | null };

export type InventoryData = {
  characters: InventoryCharacter[];
  entries: InventoryEntry[];
  guilds: InventoryGuild[];
  items: Record<string, InventoryItemInfo>;
  /** Valeur de marché d'une unité, en pièces de cuivre ; un objet sans prix connu est absent. */
  prices: Record<string, number>;
  /** Hôtel des ventes dont viennent les prix ; null tant qu'aucun relevé n'a été reçu. */
  market: { id: number; label: string } | null;
};

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

export async function loadInventory(db: Database, now: Date = new Date()): Promise<InventoryData> {
  const [characterRows, stored, held, sources, guildRows, guildItems] = await Promise.all([
    db
      .select({
        id: t.characters.id,
        name: t.characters.name,
        realm: t.realms.name,
        class: t.characters.class,
        level: t.characters.level,
        bagsAt: t.characters.bagsAt,
        bankAt: t.characters.bankAt,
        accountId: t.wowAccounts.id,
        accountDisplayName: t.wowAccounts.displayName,
        accountFolderHint: t.wowAccounts.folderHint,
        accountFeatured: t.wowAccounts.featured,
      })
      .from(t.characters)
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
      .orderBy(asc(t.characters.name)),
    db
      .select({ characterId: t.characterItems.characterId, location: t.characterItems.location, itemKey: t.characterItems.itemKey, quantity: t.characterItems.quantity })
      .from(t.characterItems),
    db
      .select({
        characterId: t.characterHoldings.characterId,
        location: t.characterHoldings.location,
        itemKey: t.characterHoldings.itemKey,
        quantity: t.characterHoldings.quantity,
        expiresAt: t.characterHoldings.expiresAt,
      })
      .from(t.characterHoldings),
    db.select({ characterId: t.characterHoldingSources.characterId, fileModifiedAt: t.characterHoldingSources.fileModifiedAt }).from(t.characterHoldingSources),
    db
      .select({
        id: t.guildBanks.id,
        name: t.guildBanks.name,
        realm: t.guildBanks.realm,
        moneyCopper: t.guildBanks.moneyCopper,
        tabNames: t.guildBanks.tabNames,
        fileModifiedAt: t.guildBanks.fileModifiedAt,
        accountId: t.guildBanks.accountId,
        accountDisplayName: t.wowAccounts.displayName,
        accountFolderHint: t.wowAccounts.folderHint,
      })
      .from(t.guildBanks)
      .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.guildBanks.accountId)),
    db.select().from(t.guildBankItems).orderBy(asc(t.guildBankItems.tab)),
  ]);

  const holdingsAt = new Map(sources.map((source) => [source.characterId, source.fileModifiedAt]));
  const characters: InventoryCharacter[] = characterRows.map((row) => ({
    id: row.id,
    name: row.name,
    realm: row.realm,
    class: row.class,
    level: row.level,
    account: { id: row.accountId, label: accountLabel({ displayName: row.accountDisplayName, folderHint: row.accountFolderHint }), featured: row.accountFeatured },
    seen: { bags: iso(row.bagsAt), bank: iso(row.bankAt), mail: iso(holdingsAt.get(row.id) ?? null), auctions: iso(holdingsAt.get(row.id) ?? null) },
  }));

  const entries: InventoryEntry[] = [
    ...stored.map((row) => ({ ...row, location: row.location as InventoryLocation, expiresAt: null })),
    ...held.map((row) => ({ ...row, location: row.location as InventoryLocation, expiresAt: iso(row.expiresAt) })),
  ];

  // Une même guilde vue depuis deux comptes : le relevé le plus récent l'emporte. Une guilde d'un
  // royaume où le compte n'a plus de personnage (réinitialisation) attend sa suppression à la
  // prochaine synchronisation : elle n'est déjà plus montrée.
  const accountRealms = new Set(characterRows.map((row) => `${row.accountId}\u0000${row.realm}`));
  const latestGuilds = new Map<string, (typeof guildRows)[number]>();
  for (const row of guildRows) {
    if (!accountRealms.has(`${row.accountId}\u0000${row.realm}`)) continue;
    const key = `${row.name}\u0000${row.realm}`;
    const known = latestGuilds.get(key);
    if (!known || row.fileModifiedAt.getTime() > known.fileModifiedAt.getTime()) latestGuilds.set(key, row);
  }
  const guilds: InventoryGuild[] = [...latestGuilds.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "fr"))
    .map((row) => {
      const items = guildItems.filter((item) => item.guildBankId === row.id);
      const indexes = [...new Set([...Object.keys(row.tabNames).map(Number), ...items.map((item) => item.tab)])].sort((a, b) => a - b);
      return {
        id: row.id,
        name: row.name,
        realm: row.realm,
        accountId: row.accountId,
        accountLabel: accountLabel({ displayName: row.accountDisplayName, folderHint: row.accountFolderHint }),
        moneyCopper: row.moneyCopper,
        seenAt: row.fileModifiedAt.toISOString(),
        tabs: indexes.map((index) => ({
          index,
          name: row.tabNames[String(index)] ?? null,
          items: items.filter((item) => item.tab === index).map((item) => ({ itemKey: item.itemKey, quantity: item.quantity })),
        })),
      };
    });

  const keys = [...new Set([...entries.map((entry) => entry.itemKey), ...guilds.flatMap((guild) => guild.tabs.flatMap((tab) => tab.items.map((item) => item.itemKey)))])];
  const [names, prices] = await Promise.all([loadItemNames(db, keys), loadMarketValues(db, keys, now)]);
  const items: Record<string, InventoryItemInfo> = {};
  for (const key of keys) {
    // Nom relevé par l'addon, sinon celui de la table du jeu, rangé sous l'identifiant de base.
    const own = names.get(key);
    const id = catalogId(key);
    const base = id === null ? undefined : names.get(String(id));
    const info = { name: own?.name ?? base?.name ?? null, quality: own?.quality ?? base?.quality ?? null, icon: own?.icon ?? null };
    if (info.name !== null || info.quality !== null || info.icon !== null) items[key] = info;
  }

  return { characters, entries, guilds, items, prices: Object.fromEntries(prices.values), market: prices.market };
}
