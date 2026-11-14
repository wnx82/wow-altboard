import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { SLOT_LABELS } from "@/lib/wow/format";
import { accountLabel } from "./queries";
import { OTHER_GROUP } from "./reputations";
import type { SearchParams } from "./roster-filter";

// Comparateur : deux à quatre personnages côte à côte (identité, statistiques, équipement,
// métiers, réputations, temps par niveau). Les lignes se construisent sans base ; seule
// loadComparison lit PostgreSQL.

export const MAX_COMPARED = 4;

/** Personnages choisis, dans l'ordre de l'adresse (?c=12&c=7), sans doublon. */
export function readCompareIds(params: SearchParams): number[] {
  const raw = params.c;
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const ids: number[] = [];
  for (const value of values.flatMap((entry) => entry.split(","))) {
    if (!/^[1-9]\d{0,8}$/.test(value)) continue;
    const id = Number(value);
    if (!ids.includes(id)) ids.push(id);
    if (ids.length === MAX_COMPARED) break;
  }
  return ids;
}

/** Une ligne du comparateur : une valeur affichée par personnage, et les colonnes en tête. */
export type CompareRow = { key: string; label: string; values: (string | null)[]; best: number[] };

/**
 * Colonnes en tête d'une ligne : la plus forte valeur (ou la plus faible avec `lowerIsBetter`),
 * seulement quand au moins deux personnages ont une valeur et qu'elles diffèrent.
 */
export function bestOf(numbers: readonly (number | null)[], lowerIsBetter = false): number[] {
  const known = numbers.filter((value): value is number => value !== null);
  if (known.length < 2 || known.every((value) => value === known[0])) return [];
  const target = lowerIsBetter ? Math.min(...known) : Math.max(...known);
  return numbers.flatMap((value, index) => (value === target ? [index] : []));
}

type Stats = typeof t.characterStats.$inferSelect;
type StatField = { key: keyof Omit<Stats, "characterId" | "powerType">; label: string; percent?: boolean };

/** Mêmes statistiques, dans le même ordre, que la fiche d'un personnage. */
export const STAT_FIELDS: readonly StatField[] = [
  { key: "strength", label: "Force" },
  { key: "agility", label: "Agilité" },
  { key: "stamina", label: "Endurance" },
  { key: "intellect", label: "Intelligence" },
  { key: "spirit", label: "Esprit" },
  { key: "armor", label: "Armure" },
  { key: "health", label: "Points de vie" },
  { key: "power", label: "Ressource" },
  { key: "attackPower", label: "Puissance d'attaque" },
  { key: "rangedAttackPower", label: "Puissance d'attaque à distance" },
  { key: "crit", label: "Critique", percent: true },
  { key: "rangedCrit", label: "Critique à distance", percent: true },
  { key: "hit", label: "Toucher", percent: true },
  { key: "dodge", label: "Esquive", percent: true },
  { key: "parry", label: "Parade", percent: true },
  { key: "block", label: "Blocage", percent: true },
  { key: "defense", label: "Défense" },
  { key: "spellPower", label: "Puissance des sorts" },
  { key: "spellCrit", label: "Critique des sorts", percent: true },
  { key: "healing", label: "Soins" },
  { key: "spellHit", label: "Toucher des sorts", percent: true },
  { key: "resFire", label: "Résistance au feu" },
  { key: "resNature", label: "Résistance à la nature" },
  { key: "resFrost", label: "Résistance au givre" },
  { key: "resShadow", label: "Résistance à l'ombre" },
  { key: "resArcane", label: "Résistance aux arcanes" },
];

const integer = new Intl.NumberFormat("fr-FR");
const percentFormat = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Statistiques connues d'au moins un personnage ; la ressource n'est comparée qu'entre ressources de même nature. */
export function statRows(stats: readonly (Stats | null)[]): CompareRow[] {
  const rows: CompareRow[] = [];
  for (const field of STAT_FIELDS) {
    const numbers = stats.map((row) => (row?.[field.key] ?? null) as number | null);
    if (numbers.every((value) => value === null)) continue;
    const powerTypes = new Set(stats.map((row) => row?.powerType ?? null).filter((type) => type !== null));
    const comparable = field.key !== "power" || powerTypes.size <= 1;
    rows.push({
      key: field.key,
      label: field.key === "power" && powerTypes.size === 1 ? `Ressource (${[...powerTypes][0]})` : field.label,
      values: numbers.map((value, index) =>
        value === null
          ? null
          : field.percent
            ? `${percentFormat.format(value)} %`
            : `${integer.format(value)}${field.key === "power" && powerTypes.size > 1 && stats[index]?.powerType ? ` (${stats[index]!.powerType})` : ""}`,
      ),
      best: comparable ? bestOf(numbers) : [],
    });
  }
  return rows;
}

export type CompareEquipment = { slot: number; name: string | null; quality: number | null; itemLevel: number | null; itemId: number | null };
export type EquipmentRow = { slot: number; label: string; items: (CompareEquipment | null)[]; best: number[] };

/** Emplacements occupés chez au moins un personnage, dans l'ordre du jeu ; en tête, le plus haut niveau d'objet. */
export function equipmentRows(equipment: readonly (readonly CompareEquipment[])[]): EquipmentRow[] {
  const rows: EquipmentRow[] = [];
  for (const slot of Object.keys(SLOT_LABELS).map(Number)) {
    const items = equipment.map((list) => list.find((item) => item.slot === slot && (item.itemId !== null || item.name !== null)) ?? null);
    if (items.every((item) => item === null)) continue;
    rows.push({ slot, label: SLOT_LABELS[slot], items, best: bestOf(items.map((item) => item?.itemLevel ?? null)) });
  }
  return rows;
}

export type CompareProfession = { skillLine: number; name: string; rank: number | null; maxRank: number | null };

/** Métiers exercés par au moins un personnage, par ordre alphabétique ; en tête, le meilleur rang. */
export function professionRows(professions: readonly (readonly CompareProfession[])[], compareNames: (a: string, b: string) => number): CompareRow[] {
  const names = new Map<number, string>();
  for (const list of professions) for (const profession of list) names.set(profession.skillLine, profession.name);
  return [...names]
    .sort(([, a], [, b]) => compareNames(a, b))
    .map(([skillLine, name]) => {
      const held = professions.map((list) => list.find((profession) => profession.skillLine === skillLine) ?? null);
      return {
        key: String(skillLine),
        label: name,
        values: held.map((profession) => (profession === null ? null : `${profession.rank ?? "—"} / ${profession.maxRank ?? "—"}`)),
        best: bestOf(held.map((profession) => profession?.rank ?? null)),
      };
    });
}

export type CompareReputation = {
  factionId: number;
  name: string;
  groupName: string | null;
  reaction: number | null;
  currentValue: number | null;
  minValue: number | null;
};
export type ReputationCompareRow = CompareRow & { group: string };

/**
 * Factions connues d'au moins un personnage, groupées comme dans l'addon. La valeur montre le
 * palier puis l'avancement dans le palier ; en tête, le palier le plus haut, puis l'avancement.
 */
export function reputationRows(
  reputations: readonly (readonly CompareReputation[])[],
  reactionLabel: (reaction: number) => string,
  compareNames: (a: string, b: string) => number,
): ReputationCompareRow[] {
  const factions = new Map<number, { name: string; group: string }>();
  for (const list of reputations) for (const row of list) factions.set(row.factionId, { name: row.name, group: row.groupName ?? OTHER_GROUP });
  return [...factions]
    .sort(([, a], [, b]) => (a.group === b.group ? compareNames(a.name, b.name) : a.group === OTHER_GROUP ? 1 : b.group === OTHER_GROUP ? -1 : compareNames(a.group, b.group)))
    .map(([factionId, faction]) => {
      const held = reputations.map((list) => list.find((row) => row.factionId === factionId) ?? null);
      const within = (row: CompareReputation | null) => (row?.currentValue != null && row.minValue != null ? row.currentValue - row.minValue : null);
      return {
        key: String(factionId),
        label: faction.name,
        group: faction.group,
        values: held.map((row) => {
          if (row === null) return null;
          const tier = row.reaction === null ? "Palier inconnu" : reactionLabel(row.reaction);
          const progress = within(row);
          return progress === null ? tier : `${tier} · ${integer.format(progress)}`;
        }),
        // Palier d'abord ; à palier égal, l'avancement départage (un million par palier suffit).
        best: bestOf(held.map((row) => (row === null || row.reaction === null ? null : row.reaction * 1_000_000 + (within(row) ?? 0)))),
      };
    });
}

export type CompareLevelTime = { level: number; playedSeconds: number | null };

/** Niveaux terminés par au moins un personnage ; en tête, le plus rapide. */
export function levelTimeRows(levelTimes: readonly (readonly CompareLevelTime[])[], format: (seconds: number) => string): CompareRow[] {
  const levels = [...new Set(levelTimes.flatMap((list) => list.map((row) => row.level)))].sort((a, b) => a - b);
  return levels.map((level) => {
    const seconds = levelTimes.map((list) => list.find((row) => row.level === level)?.playedSeconds ?? null);
    return {
      key: String(level),
      label: `${level} → ${level + 1}`,
      values: seconds.map((value) => (value === null ? null : format(value))),
      best: bestOf(seconds, true),
    };
  });
}

export type ComparedCharacter = {
  id: number;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  guild: string | null;
  itemLevel: number | null;
  moneyCopper: number | null;
  account: string;
  playedSeconds: number | null;
  stats: Stats | null;
  equipment: CompareEquipment[];
  professions: CompareProfession[];
  reputations: CompareReputation[];
  levelTimes: CompareLevelTime[];
};

/** Personnages demandés, dans l'ordre demandé ; un identifiant inconnu est ignoré. */
export async function loadComparison(db: Database, ids: readonly number[]): Promise<ComparedCharacter[]> {
  if (ids.length === 0) return [];
  const list = [...ids];
  const [characters, stats, equipment, professions, reputations, playtime, levelTimes] = await Promise.all([
    db
      .select({
        id: t.characters.id,
        name: t.characters.name,
        realm: t.realms.name,
        class: t.characters.class,
        race: t.characters.race,
        faction: t.characters.faction,
        level: t.characters.level,
        guild: t.characters.guild,
        itemLevel: t.characters.itemLevel,
        moneyCopper: t.characters.moneyCopper,
        accountDisplayName: t.wowAccounts.displayName,
        accountFolderHint: t.wowAccounts.folderHint,
      })
      .from(t.characters)
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
      .where(inArray(t.characters.id, list)),
    db.select().from(t.characterStats).where(inArray(t.characterStats.characterId, list)),
    db
      .select({
        characterId: t.characterEquipment.characterId,
        slot: t.characterEquipment.slot,
        name: t.characterEquipment.name,
        quality: t.characterEquipment.quality,
        itemLevel: t.characterEquipment.itemLevel,
        itemId: t.characterEquipment.itemId,
      })
      .from(t.characterEquipment)
      .where(inArray(t.characterEquipment.characterId, list)),
    db
      .select({
        characterId: t.characterProfessions.characterId,
        skillLine: t.characterProfessions.skillLine,
        name: t.characterProfessions.name,
        rank: t.characterProfessions.rank,
        maxRank: t.characterProfessions.maxRank,
      })
      .from(t.characterProfessions)
      .where(inArray(t.characterProfessions.characterId, list))
      .orderBy(asc(t.characterProfessions.position)),
    db
      .select({
        characterId: t.characterReputations.characterId,
        factionId: t.characterReputations.factionId,
        name: t.characterReputations.name,
        groupName: t.characterReputations.groupName,
        reaction: t.characterReputations.reaction,
        currentValue: t.characterReputations.currentValue,
        minValue: t.characterReputations.minValue,
      })
      .from(t.characterReputations)
      .where(inArray(t.characterReputations.characterId, list)),
    db
      .select({ characterId: t.characterPlaytime.characterId, totalSeconds: t.characterPlaytime.totalSeconds })
      .from(t.characterPlaytime)
      .where(inArray(t.characterPlaytime.characterId, list)),
    db
      .select({ characterId: t.characterLevelTimes.characterId, level: t.characterLevelTimes.level, playedSeconds: t.characterLevelTimes.playedSeconds })
      .from(t.characterLevelTimes)
      .where(inArray(t.characterLevelTimes.characterId, list)),
  ]);

  const of = <T extends { characterId: number }>(rows: readonly T[], id: number) => rows.filter((row) => row.characterId === id);
  return list.flatMap((id) => {
    const character = characters.find((row) => row.id === id);
    if (!character) return [];
    const { accountDisplayName, accountFolderHint, ...core } = character;
    return [
      {
        ...core,
        account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }),
        playedSeconds: playtime.find((row) => row.characterId === id)?.totalSeconds ?? null,
        stats: stats.find((row) => row.characterId === id) ?? null,
        equipment: of(equipment, id).map((row) => ({ ...row, slot: Number(row.slot) })),
        professions: of(professions, id),
        reputations: of(reputations, id).map((row) => ({ ...row, reaction: row.reaction === null ? null : Number(row.reaction) })),
        levelTimes: of(levelTimes, id).map((row) => ({ ...row, level: Number(row.level) })),
      },
    ];
  });
}

export type CompareOption = { id: number; name: string; realm: string; level: number | null; account: string };

/** Personnages proposés au choix, du plus haut niveau au plus bas. */
export async function listCompareOptions(db: Database): Promise<CompareOption[]> {
  const rows = await db
    .select({
      id: t.characters.id,
      name: t.characters.name,
      realm: t.realms.name,
      level: t.characters.level,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
    })
    .from(t.characters)
    .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .orderBy(sql`${t.characters.level} desc nulls last`, asc(t.characters.name));
  return rows.map(({ accountDisplayName, accountFolderHint, ...row }) => ({ ...row, account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }) }));
}
