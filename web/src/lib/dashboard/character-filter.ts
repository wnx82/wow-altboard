// Recherche, filtres et tri de la liste des personnages de l'accueil. Pur : partagé par le
// composant client et ses tests.

import type { Filters, GoalState, Sort, SortKey } from "@/lib/dashboard/browser-state";
import type { CharacterListItem } from "@/lib/dashboard/queries";
import { classLabel } from "@/lib/wow/format";
import { fold } from "./inventory-view";

export const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function goalState(goals: CharacterListItem["goals"]): GoalState {
  if (goals.total === 0) return "none";
  return goals.done < goals.total ? "open" : "done";
}

function sortValue(character: CharacterListItem, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return character.name;
    case "level":
      return character.level;
    case "itemLevel":
      return character.itemLevel;
    case "money":
      return character.moneyCopper;
    case "activity":
      return Date.parse(character.sourceLastSeenAt);
    case "progress":
      return character.xp !== null && character.xpMax ? character.xp / character.xpMax : null;
  }
}

export type CharacterQuery = { query: string; filters: Filters; favoritesOnly: boolean };

/** Personnages qui passent la recherche (nom, classe, race, royaume, compte, guilde, métier, étiquette, note) et chaque filtre. */
export function filterCharacters<T extends CharacterListItem>(characters: T[], { query, filters, favoritesOnly }: CharacterQuery): T[] {
  const needle = fold(query.trim());
  const minLevel = filters.minLevel === "" ? null : Number(filters.minLevel);
  const maxLevel = filters.maxLevel === "" ? null : Number(filters.maxLevel);
  return characters.filter((c) => {
    if (favoritesOnly && !c.account.featured) return false;
    if (filters.account && String(c.account.id) !== filters.account) return false;
    if (filters.realm && c.realm !== filters.realm) return false;
    if (filters.classToken && c.class !== filters.classToken) return false;
    if (filters.race && c.race !== filters.race) return false;
    if (filters.faction && c.faction !== filters.faction) return false;
    if (filters.profession && !c.professions.some((p) => p.name === filters.profession)) return false;
    if (filters.machine && !c.machines.some((m) => String(m.id) === filters.machine)) return false;
    if (filters.goals && goalState(c.goals) !== filters.goals) return false;
    if (filters.tag && !c.tags.includes(filters.tag)) return false;
    if (minLevel !== null && (c.level === null || c.level < minLevel)) return false;
    if (maxLevel !== null && (c.level === null || c.level > maxLevel)) return false;
    if (!needle) return true;
    const haystack = [c.name, classLabel(c.class), c.race, c.realm, c.account.label, c.guild, ...c.professions.map((p) => p.name), ...c.tags, c.note];
    return haystack.some((value) => value && fold(value).includes(needle));
  });
}

/** Tri stable : valeurs absentes toujours à la fin, quel que soit le sens ; à égalité, le nom. */
export function sortCharacters<T extends CharacterListItem>(characters: T[], sort: Sort): T[] {
  return [...characters].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null || right === null) return left === right ? collator.compare(a.name, b.name) : left === null ? 1 : -1;
    const order = typeof left === "string" ? collator.compare(left, right as string) : left - (right as number);
    return (sort.descending ? -order : order) || collator.compare(a.name, b.name);
  });
}
