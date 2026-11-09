import { and, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { machineLabel, type CharacterListItem } from "./queries";

// Bloc « À surveiller » de l'accueil : ce qui demande une action en jeu, calculé à partir des
// données déjà synchronisées. Aucune notification : le bloc se lit en ouvrant le tableau de bord.

/** Un PC muet depuis ce nombre de jours est signalé (accueil et page Machines). */
export const SILENT_MACHINE_DAYS = 7;
/** Un personnage non relevé depuis ce nombre de jours est signalé. */
export const STALE_CHARACTER_DAYS = 14;
/** Sacs presque pleins : il reste au plus ce nombre de places. */
export const FULL_BAGS_FREE_SLOTS = 2;
/** Rang le plus haut d'un métier : un métier au maximum de son palier en dessous attend une formation. */
export const PROFESSION_CAP = 300;
/**
 * Emplacements d'équipement attendus : sans chemise, tabard, main gauche (une arme à deux mains
 * l'occupe) ni arme à distance (toutes les classes n'en portent pas).
 */
export const EXPECTED_SLOTS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
/** En dessous, un personnage n'a pas encore de quoi remplir ses emplacements : rien n'est signalé. */
export const EQUIPMENT_MIN_LEVEL = 10;

const DAY = 24 * 3600 * 1000;

export type WatchCharacter = Pick<CharacterListItem, "id" | "name" | "class" | "level" | "hidden" | "professions" | "sourceLastSeenAt">;

export type WatchFacts = {
  bagSlotsUsed: number | null;
  bagSlotsTotal: number | null;
  bankAt: Date | null;
  /** Emplacements occupés ; null si l'équipement n'a jamais été relevé. */
  equippedSlots: number[] | null;
};

export type WatchMachine = { id: number; label: string; lastSeenAt: Date };

export type WatchEntry = { character: WatchCharacter; detail: string };

export type WatchList = {
  bags: WatchEntry[];
  bank: WatchEntry[];
  stale: WatchEntry[];
  emptySlots: WatchEntry[];
  professions: WatchEntry[];
  silentMachines: { machine: WatchMachine; days: number }[];
};

const daysSince = (date: Date, now: Date) => Math.floor((now.getTime() - date.getTime()) / DAY);
const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/** Un PC est muet quand il n'a rien envoyé depuis SILENT_MACHINE_DAYS jours ou plus. */
export function silentDays(lastSeenAt: Date, now: Date): number | null {
  const days = daysSince(lastSeenAt, now);
  return days >= SILENT_MACHINE_DAYS ? days : null;
}

/**
 * Ce qui demande une action, par sorte. Les personnages masqués dans l'addon sont ignorés ; l'ordre
 * reçu (niveau décroissant) est conservé dans chaque liste.
 */
export function buildWatchList(characters: WatchCharacter[], facts: Map<number, WatchFacts>, machines: WatchMachine[], now: Date): WatchList {
  const list: WatchList = { bags: [], bank: [], stale: [], emptySlots: [], professions: [], silentMachines: [] };

  for (const character of characters) {
    if (character.hidden) continue;
    const fact = facts.get(character.id);

    if (fact?.bagSlotsTotal && fact.bagSlotsUsed !== null) {
      const free = Math.max(0, fact.bagSlotsTotal - fact.bagSlotsUsed);
      if (free <= FULL_BAGS_FREE_SLOTS) list.bags.push({ character, detail: free === 0 ? "pleins" : plural(free, "place libre", "places libres") });
    }
    if (fact && fact.bankAt === null) list.bank.push({ character, detail: "jamais relevée" });

    const unseen = daysSince(new Date(character.sourceLastSeenAt), now);
    if (unseen >= STALE_CHARACTER_DAYS) list.stale.push({ character, detail: `${unseen} jours` });

    if (fact?.equippedSlots && (character.level ?? 0) >= EQUIPMENT_MIN_LEVEL) {
      const filled = new Set(fact.equippedSlots);
      const empty = EXPECTED_SLOTS.filter((slot) => !filled.has(slot)).length;
      if (empty > 0) list.emptySlots.push({ character, detail: plural(empty, "vide", "vides") });
    }

    for (const profession of character.professions) {
      const { rank, maxRank } = profession;
      if (rank !== null && maxRank !== null && maxRank < PROFESSION_CAP && rank >= maxRank) {
        list.professions.push({ character, detail: `${profession.name} ${rank}/${maxRank}` });
      }
    }
  }

  for (const machine of machines) {
    const days = silentDays(machine.lastSeenAt, now);
    if (days !== null) list.silentMachines.push({ machine, days });
  }
  list.silentMachines.sort((a, b) => b.days - a.days);
  return list;
}

export const watchCount = (list: WatchList) =>
  list.bags.length + list.bank.length + list.stale.length + list.emptySlots.length + list.professions.length + list.silentMachines.length;

/** Sacs, banque et emplacements équipés de chaque personnage, en deux requêtes. */
export async function loadWatchFacts(db: Database, characterIds: number[]): Promise<Map<number, WatchFacts>> {
  const facts = new Map<number, WatchFacts>();
  if (characterIds.length === 0) return facts;
  const [rows, equipment] = await Promise.all([
    db
      .select({ id: t.characters.id, bagSlotsUsed: t.characters.bagSlotsUsed, bagSlotsTotal: t.characters.bagSlotsTotal, bankAt: t.characters.bankAt })
      .from(t.characters)
      .where(inArray(t.characters.id, characterIds)),
    db
      .select({ characterId: t.characterEquipment.characterId, slot: t.characterEquipment.slot })
      .from(t.characterEquipment)
      .where(and(inArray(t.characterEquipment.characterId, characterIds), isNotNull(t.characterEquipment.itemId))),
  ]);
  const slots = Map.groupBy(equipment, (row) => row.characterId);
  for (const row of rows) {
    facts.set(row.id, {
      bagSlotsUsed: row.bagSlotsUsed,
      bagSlotsTotal: row.bagSlotsTotal,
      bankAt: row.bankAt,
      equippedSlots: slots.get(row.id)?.map((entry) => entry.slot) ?? null,
    });
  }
  return facts;
}

/** Date du dernier envoi de chaque PC. */
export async function loadWatchMachines(db: Database): Promise<WatchMachine[]> {
  const rows = await db
    .select({ id: t.machines.id, displayName: t.machines.displayName, hostname: t.machines.hostname, lastSeenAt: t.machines.lastSeenAt })
    .from(t.machines);
  return rows.map((row) => ({ id: row.id, label: machineLabel(row), lastSeenAt: row.lastSeenAt }));
}
