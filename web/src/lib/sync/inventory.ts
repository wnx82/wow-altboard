import { eq, inArray } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { canonicalHash } from "@/lib/hash";
import type { AccountPayload, BaganatorPayload } from "./schema";

// Courrier, enchères en cours et banques de guilde relevés par l'addon Baganator (agent 0.8.0,
// voir docs/BAGANATOR-DATA-MODEL.md). Sacs et banque restent ceux d'AltBoard (character_items).

const BATCH = 2_000;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function dedupe<T>(values: readonly T[], key: (value: T) => string | number): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

const fromUnix = (seconds: number | undefined) => (seconds === undefined ? null : new Date(seconds * 1000));

/**
 * À appeler après les personnages du compte : seuls ceux déjà connus reçoivent leur courrier. Un
 * fichier plus ancien que celui qui a fourni l'état connu (autre PC) ne remplace rien.
 */
export async function applyBaganator(tx: DatabaseOrTransaction, account: AccountPayload, accountId: number, now: Date): Promise<void> {
  const payload = account.baganator;
  if (!payload) return;
  const fileModifiedAt = new Date(payload.file.modifiedAt);
  await applyHoldings(tx, payload.characters, fileModifiedAt, now);
  await applyGuildBanks(tx, payload.guilds, accountId, fileModifiedAt, now);
}

async function applyHoldings(tx: DatabaseOrTransaction, characters: BaganatorPayload["characters"], fileModifiedAt: Date, now: Date): Promise<void> {
  if (characters.length === 0) return;
  const guids = [...new Set(characters.map((c) => c.guid))];
  const rows = await tx.select({ id: t.characters.id, guid: t.characters.guid }).from(t.characters).where(inArray(t.characters.guid, guids));
  const ids = new Map(rows.map((row) => [row.guid, row.id]));
  if (ids.size === 0) return;
  const sources = await tx
    .select()
    .from(t.characterHoldingSources)
    .where(inArray(t.characterHoldingSources.characterId, [...ids.values()]));
  const sourceOf = new Map(sources.map((source) => [source.characterId, source]));

  for (const character of dedupe(characters, (c) => c.guid)) {
    const characterId = ids.get(character.guid);
    if (characterId === undefined) continue;
    const holdings = [
      ...dedupe(character.mail, (h) => h.key).map((h) => ({ location: "mail" as const, ...h })),
      ...dedupe(character.auctions, (h) => h.key).map((h) => ({ location: "auctions" as const, ...h })),
    ];
    const contentHash = canonicalHash(holdings.map((h) => [h.location, h.key, h.count, h.expiresAt ?? null]));
    const source = sourceOf.get(characterId);
    if (source && (source.contentHash === contentHash || source.fileModifiedAt.getTime() > fileModifiedAt.getTime())) continue;

    await tx.delete(t.characterHoldings).where(eq(t.characterHoldings.characterId, characterId));
    for (const batch of chunks(holdings, BATCH)) {
      await tx.insert(t.characterHoldings).values(
        batch.map((h) => ({ characterId, location: h.location, itemKey: h.key, quantity: h.count, expiresAt: fromUnix(h.expiresAt) })),
      );
    }
    await tx
      .insert(t.characterHoldingSources)
      .values({ characterId, fileModifiedAt, contentHash })
      .onConflictDoUpdate({ target: t.characterHoldingSources.characterId, set: { fileModifiedAt, contentHash, updatedAt: now } });
  }
}

async function applyGuildBanks(tx: DatabaseOrTransaction, guilds: BaganatorPayload["guilds"], accountId: number, fileModifiedAt: Date, now: Date): Promise<void> {
  // Seules les guildes d'un royaume où le compte a des personnages : Syndicator garde les guildes de
  // la bêta, qu'une réinitialisation des personnages a écartées avec leurs membres. Une banque déjà
  // gardée dont le royaume n'a plus de personnage du compte est supprimée.
  const realmRows = await tx
    .selectDistinct({ name: t.realms.name })
    .from(t.characters)
    .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
    .where(eq(t.characters.accountId, accountId));
  const realms = new Set(realmRows.map((realm) => realm.name));
  const stored = await tx
    .select({ id: t.guildBanks.id, name: t.guildBanks.name, realm: t.guildBanks.realm, fileModifiedAt: t.guildBanks.fileModifiedAt, contentHash: t.guildBanks.contentHash })
    .from(t.guildBanks)
    .where(eq(t.guildBanks.accountId, accountId));
  const orphans = stored.filter((bank) => !realms.has(bank.realm)).map((bank) => bank.id);
  if (orphans.length > 0) await tx.delete(t.guildBanks).where(inArray(t.guildBanks.id, orphans));
  const existing = stored.filter((bank) => realms.has(bank.realm));
  const keyOf = (name: string, realm: string) => `${name}\u0000${realm}`;
  const known = new Map(existing.map((bank) => [keyOf(bank.name, bank.realm), bank]));

  for (const guild of dedupe(guilds, (g) => keyOf(g.name, g.realm))) {
    if (!realms.has(guild.realm)) continue;
    const tabs = dedupe(guild.tabs, (tab) => tab.index).map((tab) => ({ ...tab, items: dedupe(tab.items, (item) => item.key) }));
    const contentHash = canonicalHash([guild.moneyCopper ?? null, tabs.map((tab) => [tab.index, tab.name ?? null, tab.items.map((item) => [item.key, item.count])])]);
    const previous = known.get(keyOf(guild.name, guild.realm));
    if (previous && (previous.contentHash === contentHash || previous.fileModifiedAt.getTime() > fileModifiedAt.getTime())) continue;

    const tabNames = Object.fromEntries(tabs.filter((tab) => tab.name !== undefined).map((tab) => [String(tab.index), tab.name!]));
    const values = { moneyCopper: guild.moneyCopper ?? null, tabNames, fileModifiedAt, contentHash, updatedAt: now };
    const [bank] = await tx
      .insert(t.guildBanks)
      .values({ accountId, name: guild.name, realm: guild.realm, ...values })
      .onConflictDoUpdate({ target: [t.guildBanks.accountId, t.guildBanks.name, t.guildBanks.realm], set: values })
      .returning({ id: t.guildBanks.id });
    await tx.delete(t.guildBankItems).where(eq(t.guildBankItems.guildBankId, bank.id));
    const items = tabs.flatMap((tab) => tab.items.map((item) => ({ guildBankId: bank.id, tab: tab.index, itemKey: item.key, quantity: item.count })));
    for (const batch of chunks(items, BATCH)) await tx.insert(t.guildBankItems).values(batch);
  }
}
