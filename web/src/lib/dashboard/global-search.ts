import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { itemHref } from "@/lib/economy/view";
import { loadItemIcons } from "@/lib/wow/icon-files";
import { fold } from "./inventory-view";

// Recherche globale (Ctrl+K) : personnages et objets, en quelques requêtes bornées. Les pages du
// menu sont cherchées par le navigateur, sans appel au serveur.

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 60;
export const MAX_CHARACTERS = 6;
export const MAX_ITEMS = 8;

export type SearchCharacter = { id: number; name: string; realm: string; class: string | null; level: number | null };
/** owned : exemplaires possédés, tous détenteurs confondus ; un objet non possédé mène à sa fiche de marché. */
export type SearchItem = { itemKey: string; name: string; quality: number | null; icon: string | null; owned: number; href: string };
export type SearchResults = { characters: SearchCharacter[]; items: SearchItem[] };

/** Texte cherché, sans accent et en minuscules ; null quand il est trop court pour chercher. */
export function searchNeedle(raw: string | null | undefined): string | null {
  const needle = fold((raw ?? "").trim().slice(0, MAX_QUERY_LENGTH)).replace(/\s+/g, " ");
  return needle.length >= MIN_QUERY_LENGTH || /^\d+$/.test(needle) ? needle : null;
}

// Mêmes lettres que fold(), côté PostgreSQL : l'extension unaccent n'est pas requise.
const ACCENTED = "àáâäãåçèéêëìíîïñòóôöõùúûüýÿ";
const PLAIN = "aaaaaaceeeeiiiinooooouuuuyy";
const folded = (column: AnyPgColumn) => sql`translate(lower(${column}), ${ACCENTED}, ${PLAIN})`;
const contains = (column: AnyPgColumn, needle: string): SQL => sql`${folded(column)} like ${`%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;

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
  if (needle === null) return { characters: [], items: [] };
  const numeric = /^\d+$/.test(needle);
  // Un identifiant d'objet tient sur 9 chiffres (colonne integer) : au-delà, rien ne peut correspondre.
  if (numeric && needle.length > 9) return { characters: [], items: [] };
  // Objets détenus seulement : un objet que l'addon a relevé un jour ne doit pas occuper la place
  // d'un objet possédé dans les candidats.
  const held = sql`${t.items.itemKey} in (select ${t.characterItems.itemKey} from ${t.characterItems} union all select ${t.characterHoldings.itemKey} from ${t.characterHoldings} union all select ${t.guildBankItems.itemKey} from ${t.guildBankItems})`;

  const [characters, ownedRows, catalogRows] = await Promise.all([
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
  const icons = await loadItemIcons(
    db,
    items.map((item) => item.itemKey),
  );

  return {
    // Tri stable : à pertinence égale, le niveau le plus haut d'abord, comme la requête.
    characters: characters.sort((a, b) => matchRank(a.name, needle) - matchRank(b.name, needle)).slice(0, MAX_CHARACTERS),
    items: items.map((item) => ({
      ...item,
      icon: icons.get(item.itemKey) ?? null,
      href: item.owned > 0 ? `/inventory?q=${encodeURIComponent(item.name)}` : itemHref(item.itemKey),
    })),
  };
}
