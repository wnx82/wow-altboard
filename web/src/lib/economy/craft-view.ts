import { fold } from "@/lib/dashboard/inventory-view";
import type { CraftDecision, CraftEvaluation } from "./craft";
import type { KnownRecipe } from "./load";

// Vue de la page Craft : décisions classées, filtres, bilan et regroupement par métier. Fonctions pures.

export const DECISION_ORDER: CraftDecision[] = ["CRAFT", "SELL_REAGENTS", "WAIT", "DONT_CRAFT"];

export type CraftRow = { craft: CraftEvaluation; recipe: KnownRecipe };

/** Métier choisi : sa ligne de compétence, « none » pour les recettes sans métier connu, null pour tous. */
export type CraftFilter = { decision: CraftDecision | null; stock: boolean; profession: number | "none" | null; query: string };

export const NO_CRAFT_FILTER: CraftFilter = { decision: null, stock: false, profession: null, query: "" };

type Params = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

/** Filtres lus dans l'adresse ; une valeur illisible vaut l'absence de filtre. */
export function readCraftFilter(params: Params): CraftFilter {
  const decision = DECISION_ORDER.find((entry) => entry === single(params.decision)) ?? null;
  const profession = single(params.profession);
  return {
    decision,
    stock: single(params.stock) === "1",
    profession: profession === "none" ? "none" : /^[1-9]\d{0,5}$/.test(profession) ? Number(profession) : null,
    query: single(params.q).trim().slice(0, 40),
  };
}

export const craftFilterActive = (filter: CraftFilter) => filter.decision !== null || filter.stock || filter.profession !== null || filter.query !== "";

/** Adresse de la page Craft pour ces filtres ; `market` : identifiant d'un hôtel des ventes autre que celui par défaut. */
export function craftHref(filter: CraftFilter, market: number | null = null): string {
  const params = new URLSearchParams();
  if (filter.query) params.set("q", filter.query);
  if (filter.profession !== null) params.set("profession", String(filter.profession));
  if (filter.decision) params.set("decision", filter.decision);
  if (filter.stock) params.set("stock", "1");
  if (market !== null) params.set("market", String(market));
  const search = params.toString();
  return search ? `/crafting?${search}` : "/crafting";
}

/**
 * Recettes qui passent les filtres. La recherche porte, sans accents ni casse, sur le produit, les
 * composants et les personnages qui connaissent la recette.
 */
export function filterCraftRows<T extends CraftRow>(rows: readonly T[], filter: CraftFilter, itemName: (itemKey: string) => string, craftable: (row: T) => boolean): T[] {
  const needle = fold(filter.query);
  return rows.filter((row) => {
    if (filter.decision !== null && row.craft.decision !== filter.decision) return false;
    if (filter.stock && !craftable(row)) return false;
    if (filter.profession === "none" ? row.recipe.skillLine !== null : filter.profession !== null && row.recipe.skillLine !== filter.profession) return false;
    if (!needle) return true;
    const haystack = [itemName(row.craft.outputKey), ...row.craft.reagents.map((reagent) => itemName(reagent.itemKey)), ...row.recipe.characters.map((character) => character.name)];
    return haystack.some((text) => fold(text).includes(needle));
  });
}

export type ProfessionGroup<T extends CraftRow> = { summary: ProfessionSummary; rows: T[]; counts: Record<CraftDecision, number> };

/**
 * Recettes rangées par métier, dans l'ordre du bilan (métiers les plus rentables d'abord) ; dans
 * chaque métier, l'ordre reçu (celui de sortCrafts : à crafter d'abord).
 */
export function groupByProfession<T extends CraftRow>(rows: readonly T[], professionName: (skillLine: number | null) => string): ProfessionGroup<T>[] {
  const bySkill = new Map<number | null, T[]>();
  for (const row of rows) bySkill.set(row.recipe.skillLine, [...(bySkill.get(row.recipe.skillLine) ?? []), row]);
  return summarizeProfessions(rows, professionName).map((summary) => {
    const members = bySkill.get(summary.skillLine) ?? [];
    const counts = Object.fromEntries(DECISION_ORDER.map((entry) => [entry, members.filter((row) => row.craft.decision === entry).length])) as Record<CraftDecision, number>;
    return { summary, rows: members, counts };
  });
}

/** Crafts à faire d'abord (profit décroissant), puis composants à vendre, à attendre, à éviter. */
export function sortCrafts(rows: readonly CraftRow[]): CraftRow[] {
  return [...rows].sort(
    (a, b) =>
      DECISION_ORDER.indexOf(a.craft.decision) - DECISION_ORDER.indexOf(b.craft.decision) ||
      (b.craft.profit ?? -Infinity) - (a.craft.profit ?? -Infinity) ||
      a.craft.spellId - b.craft.spellId,
  );
}

export type ProfessionSummary = {
  skillLine: number | null;
  name: string;
  recipes: number;
  profitable: number;
  /** Meilleur profit unitaire parmi les crafts à faire. */
  bestProfit: number | null;
  /** Profit cumulé des lots faisables avec les stocks (composants de marchand achetés). */
  batchProfit: number;
};

export function summarizeProfessions(rows: readonly CraftRow[], professionName: (skillLine: number | null) => string): ProfessionSummary[] {
  const groups = new Map<number | null, ProfessionSummary>();
  for (const { craft, recipe } of rows) {
    const group = groups.get(recipe.skillLine) ?? {
      skillLine: recipe.skillLine,
      name: professionName(recipe.skillLine),
      recipes: 0,
      profitable: 0,
      bestProfit: null,
      batchProfit: 0,
    };
    group.recipes += 1;
    if (craft.decision === "CRAFT" && craft.profit !== null) {
      group.profitable += 1;
      group.bestProfit = Math.max(group.bestProfit ?? -Infinity, craft.profit);
      group.batchProfit += craft.batchProfit ?? 0;
    }
    groups.set(recipe.skillLine, group);
  }
  return [...groups.values()].sort((a, b) => b.batchProfit - a.batchProfit || (b.bestProfit ?? -Infinity) - (a.bestProfit ?? -Infinity) || a.name.localeCompare(b.name));
}
