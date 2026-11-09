// Réputations de tous les personnages, mises côte à côte sur le modèle de la page Métiers : pour
// chaque faction, qui en est où. Pur, sans base.

export type ReputationRow<C> = {
  character: C;
  factionId: number;
  name: string;
  groupName: string | null;
  reaction: number | null;
  currentValue: number | null;
  minValue: number | null;
  maxValue: number | null;
};

export type ReputationHolder<C> = Pick<ReputationRow<C>, "character" | "reaction" | "currentValue" | "minValue" | "maxValue">;
export type FactionRow<C> = { factionId: number; name: string; holders: ReputationHolder<C>[] };
export type FactionGroup<C> = { name: string; factions: FactionRow<C>[] };

/** Groupe affiché pour une faction sans groupe dans l'addon. */
export const OTHER_GROUP = "Autres";

/** Avancement dans le palier, de 0 à 1 ; null si les bornes manquent. */
export function standingProgress(holder: Pick<ReputationHolder<unknown>, "currentValue" | "minValue" | "maxValue">): number | null {
  const { currentValue, minValue, maxValue } = holder;
  if (currentValue === null || minValue === null || maxValue === null || maxValue <= minValue) return null;
  return Math.min(1, Math.max(0, (currentValue - minValue) / (maxValue - minValue)));
}

/**
 * Factions groupées comme dans l'addon, chaque personnage du plus avancé au moins avancé (palier,
 * puis avancement dans le palier). L'ordre reçu départage les ex æquo.
 */
export function compareReputations<C>(rows: ReputationRow<C>[], compareNames: (a: string, b: string) => number): FactionGroup<C>[] {
  const factions = new Map<number, FactionRow<C> & { group: string }>();
  for (const row of rows) {
    let faction = factions.get(row.factionId);
    if (!faction) {
      faction = { factionId: row.factionId, name: row.name, group: row.groupName ?? OTHER_GROUP, holders: [] };
      factions.set(row.factionId, faction);
    }
    faction.holders.push({ character: row.character, reaction: row.reaction, currentValue: row.currentValue, minValue: row.minValue, maxValue: row.maxValue });
  }

  const groups = new Map<string, FactionRow<C>[]>();
  for (const { group, ...faction } of factions.values()) {
    faction.holders.sort((a, b) => (b.reaction ?? 0) - (a.reaction ?? 0) || (standingProgress(b) ?? 0) - (standingProgress(a) ?? 0));
    groups.set(group, [...(groups.get(group) ?? []), faction]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === OTHER_GROUP ? 1 : b === OTHER_GROUP ? -1 : compareNames(a, b)))
    .map(([name, list]) => ({ name, factions: list.sort((a, b) => compareNames(a.name, b.name)) }));
}
