import { and, eq } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { chunks, fromUnix, uniqueBy } from "./helpers";
import type { CharacterPayload } from "./schema";

// Colonnes d'un personnage et tables filles (métiers, équipement, réputations, monnaies,
// statistiques, sacs et banque), telles que les décrit le fichier AltBoard.

const BATCH = 1_000;

/** Blocs datés à part dans l'addon : chacun n'est appliqué que s'il est au moins aussi récent. */
export type Blocks = { stats: boolean; bags: boolean; bank: boolean };

export function identityColumns(character: CharacterPayload, accountId: number, realmId: number) {
  return {
    accountId,
    realmId,
    name: character.name,
    class: character.class ?? null,
    race: character.race ?? null,
    faction: character.faction ?? null,
    level: character.level ?? null,
    xp: character.xp ?? null,
    xpMax: character.xpMax ?? null,
    restedXp: character.restedXp ?? null,
    guild: character.guild ?? null,
    zone: character.zone ?? null,
    moneyCopper: character.moneyCopper ?? null,
    itemLevel: character.itemLevel ?? null,
    hidden: character.hidden,
  };
}

export function blockColumns(character: CharacterPayload, blocks: Blocks) {
  return {
    ...(blocks.stats && character.stats ? { statsAt: character.statsAt === undefined ? null : fromUnix(character.statsAt) } : {}),
    ...(blocks.bags && character.bags
      ? { bagsAt: fromUnix(character.bags.at), bagSlotsUsed: character.bags.slotsUsed ?? null, bagSlotsTotal: character.bags.slotsTotal ?? null }
      : {}),
    ...(blocks.bank && character.bank
      ? { bankAt: fromUnix(character.bank.at), bankSlotsUsed: character.bank.slotsUsed ?? null, bankSlotsTotal: character.bank.slotsTotal ?? null }
      : {}),
  };
}

/** Remplace les tables filles du personnage par le contenu reçu (suppression puis insertion). */
export async function replaceDetails(tx: DatabaseOrTransaction, characterId: number, character: CharacterPayload, blocks: Blocks): Promise<void> {
  await tx.delete(t.characterProfessions).where(eq(t.characterProfessions.characterId, characterId));
  const professions = uniqueBy(character.professions, (p) => p.skillLine);
  if (professions.length > 0) {
    await tx.insert(t.characterProfessions).values(
      professions.map((p, position) => ({
        characterId,
        skillLine: p.skillLine,
        name: p.name,
        rank: p.rank ?? null,
        maxRank: p.max ?? null,
        isPrimary: p.primary,
        icon: p.icon ?? null,
        position,
      })),
    );
  }

  await tx.delete(t.characterEquipment).where(eq(t.characterEquipment.characterId, characterId));
  const gear = uniqueBy(character.gear, (g) => g.slot);
  if (gear.length > 0) {
    await tx.insert(t.characterEquipment).values(
      gear.map((g) => ({
        characterId,
        slot: g.slot,
        itemId: g.itemId ?? null,
        enchantId: g.enchantId ?? null,
        name: g.name ?? null,
        quality: g.quality ?? null,
        itemLevel: g.itemLevel ?? null,
        icon: g.icon ?? null,
        link: g.link ?? null,
      })),
    );
  }

  await tx.delete(t.characterReputations).where(eq(t.characterReputations.characterId, characterId));
  const reputations = uniqueBy(character.reputations, (r) => r.factionId);
  if (reputations.length > 0) {
    await tx.insert(t.characterReputations).values(
      reputations.map((r) => ({
        characterId,
        factionId: r.factionId,
        name: r.name,
        groupName: r.group ?? null,
        reaction: r.reaction ?? null,
        currentValue: r.current ?? null,
        minValue: r.min ?? null,
        maxValue: r.max ?? null,
      })),
    );
  }

  await tx.delete(t.characterCurrencies).where(eq(t.characterCurrencies.characterId, characterId));
  const currencies = uniqueBy(character.currencies, (c) => c.name);
  if (currencies.length > 0) {
    await tx.insert(t.characterCurrencies).values(
      currencies.map((c) => ({ characterId, name: c.name, quantity: c.quantity, maxQuantity: c.max ?? null, icon: c.icon ?? null })),
    );
  }

  if (blocks.stats && character.stats) {
    const s = character.stats;
    const stats = {
      strength: s.strength ?? null,
      agility: s.agility ?? null,
      stamina: s.stamina ?? null,
      intellect: s.intellect ?? null,
      spirit: s.spirit ?? null,
      armor: s.armor ?? null,
      health: s.health ?? null,
      power: s.power ?? null,
      powerType: s.powerType ?? null,
      attackPower: s.attackPower ?? null,
      rangedAttackPower: s.rangedAttackPower ?? null,
      crit: s.crit ?? null,
      rangedCrit: s.rangedCrit ?? null,
      hit: s.hit ?? null,
      dodge: s.dodge ?? null,
      parry: s.parry ?? null,
      block: s.block ?? null,
      defense: s.defense ?? null,
      spellPower: s.spellPower ?? null,
      spellCrit: s.spellCrit ?? null,
      healing: s.healing ?? null,
      spellHit: s.spellHit ?? null,
      resFire: s.resFire ?? null,
      resNature: s.resNature ?? null,
      resFrost: s.resFrost ?? null,
      resShadow: s.resShadow ?? null,
      resArcane: s.resArcane ?? null,
    };
    await tx
      .insert(t.characterStats)
      .values({ characterId, ...stats })
      .onConflictDoUpdate({ target: t.characterStats.characterId, set: stats });
  }

  for (const location of ["bags", "bank"] as const) {
    const container = character[location];
    if (!blocks[location] || !container) continue;
    await tx.delete(t.characterItems).where(and(eq(t.characterItems.characterId, characterId), eq(t.characterItems.location, location)));
    for (const batch of chunks(uniqueBy(container.items, (item) => item.key), BATCH)) {
      await tx.insert(t.characterItems).values(batch.map((item) => ({ characterId, location, itemKey: item.key, quantity: item.count })));
    }
  }
}
