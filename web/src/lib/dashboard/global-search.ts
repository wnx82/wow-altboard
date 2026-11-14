import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { itemHref } from "@/lib/economy/view";
import { loadItemIcons } from "@/lib/wow/icon-files";
import { fold } from "./inventory-view";

// Recherche globale (Ctrl+K) : personnages, objets, recettes (qui sait fabriquer quoi) et
// factions, en quelques requêtes bornées. Les pages du menu sont cherchées par le navigateur, sans
// appel au serveur.

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 60;
export const MAX_CHARACTERS = 6;
export const MAX_ITEMS = 8;
export const MAX_RECIPES = 5;
export const MAX_FACTIONS = 4;
/** Fabricants nommés par recette ; les autres sont seulement comptés. */
export const MAX_CRAFTERS = 4;

export type SearchCharacter = { id: number; name: string; realm: string; class: string | null; level: number | null };
/** owned : exemplaires possédés, tous détenteurs confondus ; un objet non possédé mène à sa fiche de marché. */
export type SearchItem = { itemKey: string; name: string; quality: number | null; icon: string | null; owned: number; href: string };
/** Recette apprise par au moins un personnage, désignée par l'objet qu'elle fabrique. */
export type SearchRecipe = {
  spellId: number;
  itemKey: string;
  name: string;
  quality: number | null;
  icon: string | null;
  profession: string | null;
  crafters: { id: number; name: string; class: string | null }[];
  /** Fabricants au total, nommés ou non. */
  crafterCount: number;
  href: string;
};
/** Faction connue d'au moins un personnage ; best : le palier le plus avancé. */
export type SearchFaction = { factionId: number; name: string; characters: number; best: number | null; href: string };
export type SearchResults = { characters: SearchCharacter[]; items: SearchItem[]; recipes: SearchRecipe[]; factions: SearchFaction[] };

const EMPTY: SearchResults = { characters: [], items: [], recipes: [], factions: [] };

/** Texte cherché, sans accent et en minuscules ; null quand il est trop court pour chercher. */
export function searchNeedle(raw: string | null | undefined): string | null {
  const needle = fold((raw ?? "").trim().slice(0, MAX_QUERY_LENGTH)).replace(/\s+/g, " ");
  return needle.length >= MIN_QUERY_LENGTH || /^\d+$/.test(needle) ? needle : null;
}

// Mêmes lettres que fold(), côté PostgreSQL : l'extension unaccent n'est pas requise.
const ACCENTED = "àáâäãåçèéêëìíîïñòóôöõùúûüýÿ";
const PLAIN = "aaaaaaceeeeiiiinooooouuuuyy";
const folded = (column: AnyPgColumn | SQL) => sql`translate(lower(${column}), ${ACCENTED}, ${PLAIN})`;
const contains = (column: AnyPgColumn | SQL, needle: string): SQL => sql`${folded(column)} like ${`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;

/**
 * Pertinence d'un nom : 0 s'il commence par le texte cherché, 1 si l'un de ses mots commence par
 * lui (« Étoffe de lin » pour « lin »), 2 s'il le contient ailleurs (« Palourdes gobelines »).
 */
export function matchRank(name: string, needle: string): number {
  const text = fold(name);
  if (text.startsWith(needle)) return 0;
  return text.split(/[\s'’:,()-]+/).some((word) => word.startsWith(needle)) ? 1 : 2;
}

export async function searchEverything(db: Database, raw: string | null | undefined): Promise<SearchResults> {
  const needle = searchNeedle(raw);
  if (needle === null) return EMPTY;
  const numeric = /^\d+$/.test(needle);
  // Un identifiant d'objet tient sur 9 chiffres (colonne integer) : au-delà, rien ne peut correspondre.
  if (numeric && needle.length > 9) return EMPTY;
  // Objets détenus seulement : un objet que l'addon a relevé un jour ne doit pas occuper la place
  // d'un objet possédé dans les candidats.
  const held = sql`${t.items.itemKey} in (select ${t.characterItems.itemKey} from ${t.characterItems} union all select ${t.characterHoldings.itemKey} from ${t.characterHoldings} union all select ${t.guildBankItems.itemKey} from ${t.guildBankItems})`;

  const [characters, ownedRows, catalogRows, recipes, factions] = await Promise.all([
    numeric
      ? []
      : db
          .select({ id: t.characters.id, name: t.characters.name, realm: t.realms.name, class: t.characters.class, level: t.characters.level })
          .from(t.characters)
          .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
          .where(contains(t.characters.name, needle))
          .orderBy(sql`${t.characters.level} desc nulls last`, asc(t.characters.name))
          .limit(50),
    db
      .select({ itemKey: t.items.itemKey, name: t.items.name, quality: t.items.quality })
      .from(t.items)
      .where(and(numeric ? sql`(${t.items.itemKey} = ${needle} or ${t.items.itemKey} like ${`${needle}:%`})` : contains(t.items.name, needle), held))
      .orderBy(desc(t.items.quality), asc(t.items.name))
      .limit(80),
    // Objets jamais possédés : seulement ceux que l'hôtel des ventes a déjà vus, ils ont une fiche.
    db
      .select({ itemId: t.itemNames.itemId, name: t.itemNames.name, quality: t.itemNames.quality })
      .from(t.itemNames)
      .where(
        sql`${numeric ? sql`${t.itemNames.itemId} = ${Number(needle)}` : contains(t.itemNames.name, needle)} and exists (select 1 from ${t.marketItemLatest} where ${t.marketItemLatest.itemKey} = ${t.itemNames.itemId}::text)`,
      )
      .orderBy(desc(t.itemNames.quality), asc(t.itemNames.name))
      .limit(MAX_ITEMS),
    numeric ? [] : searchRecipes(db, needle),
    numeric ? [] : searchFactions(db, needle),
  ]);

  const ownedKeys = ownedRows.map((row) => row.itemKey);
  const quantities = new Map<string, number>();
  if (ownedKeys.length > 0) {
    const rows = await db.execute<{ item_key: string; quantity: number }>(sql`
      select item_key, sum(quantity)::int as quantity from (
        select ${t.characterItems.itemKey} as item_key, ${t.characterItems.quantity} as quantity from ${t.characterItems} where ${inArray(t.characterItems.itemKey, ownedKeys)}
        union all
        select ${t.characterHoldings.itemKey}, ${t.characterHoldings.quantity} from ${t.characterHoldings} where ${inArray(t.characterHoldings.itemKey, ownedKeys)}
        union all
        select ${t.guildBankItems.itemKey}, ${t.guildBankItems.quantity} from ${t.guildBankItems} where ${inArray(t.guildBankItems.itemKey, ownedKeys)}
      ) held group by item_key`);
    for (const row of rows.rows) quantities.set(row.item_key, Number(row.quantity));
  }

  // Objets possédés d'abord ; un objet relevé par l'addon mais plus détenu compte comme non possédé.
  const owned = ownedRows
    .filter((row) => row.name !== null && (quantities.get(row.itemKey) ?? 0) > 0)
    .map((row) => ({ itemKey: row.itemKey, name: row.name!, quality: row.quality, owned: quantities.get(row.itemKey)! }))
    .sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle) || b.owned - a.owned);
  const seen = new Set(owned.map((row) => row.itemKey.split(":")[0]));
  const items = [
    ...owned,
    ...catalogRows
      .filter((row) => !seen.has(String(row.itemId)))
      .map((row) => ({ itemKey: String(row.itemId), name: row.name, quality: row.quality, owned: 0 }))
      .sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle)),
  ].slice(0, MAX_ITEMS);
  const icons = await loadItemIcons(db, [...items.map((item) => item.itemKey), ...recipes.map((recipe) => recipe.itemKey)]);

  return {
    // Tri stable : à pertinence égale, le niveau le plus haut d'abord, comme la requête.
    characters: characters.sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle)).slice(0, MAX_CHARACTERS),
    items: items.map((item) => ({
      ...item,
      icon: icons.get(item.itemKey) ?? null,
      href: item.owned > 0 ? `/inventory?q=${encodeURIComponent(item.name)}` : itemHref(item.itemKey),
    })),
    recipes: recipes.map((recipe) => ({ ...recipe, icon: icons.get(recipe.itemKey) ?? null })),
    factions,
  };
}

/**
 * Recettes apprises dont l'objet fabriqué porte le texte cherché : nom relevé par l'addon, sinon
 * celui de la table du jeu. Avec leurs fabricants, du plus haut niveau au plus bas.
 */
async function searchRecipes(db: Database, needle: string): Promise<Omit<SearchRecipe, "icon">[]> {
  const name = sql<string | null>`coalesce(${t.items.name}, ${t.itemNames.name})`;
  const rows = await db
    .select({
      spellId: t.recipes.spellId,
      itemId: t.recipes.outputItemId,
      skillLine: t.recipes.skillLine,
      name,
      quality: sql<number | null>`coalesce(${t.items.quality}, ${t.itemNames.quality})`,
    })
    .from(t.recipes)
    .leftJoin(t.items, sql`${t.items.itemKey} = ${t.recipes.outputItemId}::text`)
    .leftJoin(t.itemNames, eq(t.itemNames.itemId, t.recipes.outputItemId))
    .where(and(contains(name, needle), sql`exists (select 1 from ${t.characterRecipes} where ${t.characterRecipes.spellId} = ${t.recipes.spellId})`))
    .orderBy(asc(name))
    .limit(40);
  const chosen = rows
    .filter((row): row is typeof row & { name: string } => row.name !== null)
    .sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle))
    .slice(0, MAX_RECIPES);
  if (chosen.length === 0) return [];

  const skillLines = [...new Set(chosen.map((row) => row.skillLine).filter((line): line is number => line !== null))];
  const [crafters, professions] = await Promise.all([
    db
      .select({ spellId: t.characterRecipes.spellId, id: t.characters.id, name: t.characters.name, class: t.characters.class })
      .from(t.characterRecipes)
      .innerJoin(t.characters, eq(t.characters.id, t.characterRecipes.characterId))
      .where(
        inArray(
          t.characterRecipes.spellId,
          chosen.map((row) => row.spellId),
        ),
      )
      .orderBy(sql`${t.characters.level} desc nulls last`, asc(t.characters.name)),
    skillLines.length === 0
      ? []
      : db
          .selectDistinctOn([t.characterProfessions.skillLine], { skillLine: t.characterProfessions.skillLine, name: t.characterProfessions.name })
          .from(t.characterProfessions)
          .where(inArray(t.characterProfessions.skillLine, skillLines)),
  ]);
  const professionNames = new Map(professions.map((row) => [row.skillLine, row.name]));
  return chosen.map((row) => {
    const known = crafters.filter((crafter) => crafter.spellId === row.spellId);
    return {
      spellId: row.spellId,
      itemKey: String(row.itemId),
      name: row.name,
      quality: row.quality === null ? null : Number(row.quality),
      profession: row.skillLine === null ? null : (professionNames.get(row.skillLine) ?? null),
      crafters: known.slice(0, MAX_CRAFTERS).map(({ id, name: crafter, class: classToken }) => ({ id, name: crafter, class: classToken })),
      crafterCount: known.length,
      href: itemHref(String(row.itemId)),
    };
  });
}

/** Factions connues dont le nom porte le texte cherché, avec le nombre de personnages et le meilleur palier. */
async function searchFactions(db: Database, needle: string): Promise<SearchFaction[]> {
  const rows = await db
    .select({
      factionId: t.characterReputations.factionId,
      name: sql<string>`min(${t.characterReputations.name})`,
      characters: sql<number>`count(*)::int`,
      best: sql<number | null>`max(${t.characterReputations.reaction})`,
    })
    .from(t.characterReputations)
    .where(contains(t.characterReputations.name, needle))
    .groupBy(t.characterReputations.factionId)
    .orderBy(sql`count(*) desc`)
    .limit(30);
  return rows
    .sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle))
    .slice(0, MAX_FACTIONS)
    .map((row) => ({ ...row, best: row.best === null ? null : Number(row.best), href: `/reputations?faction=${encodeURIComponent(row.name)}` }));
}
