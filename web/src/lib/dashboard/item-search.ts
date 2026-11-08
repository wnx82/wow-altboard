import { and, asc, inArray, isNotNull, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";

// « Qui possède cet objet, et combien ? » : sacs, banque et équipement de tous les personnages.

export const MAX_MATCHES = 30;
const MAX_QUERY_LENGTH = 80;

export type ItemQuery = { itemId: number } | { words: string };

// Lettres accentuées du français, ramenées à leur base des deux côtés de la comparaison :
// « etoffe » trouve « Étoffe de lin » sans l'extension unaccent.
const ACCENTED = "àáâäãåçèéêëìíîïñòóôöõùúûüýÿ";
const PLAIN = "aaaaaaceeeeiiiinooooouuuuyy";
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae");
const foldColumn = (column: unknown) => sql`replace(replace(translate(lower(${column}), ${ACCENTED}, ${PLAIN}), 'œ', 'oe'), 'æ', 'ae')`;

/** Saisie de recherche : un identifiant d'objet, ou des mots du nom (deux caractères au moins). */
export function parseItemQuery(raw: string | string[] | undefined): ItemQuery | null {
  const text = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
  if (/^[1-9]\d{0,8}$/.test(text)) return { itemId: Number(text) };
  return fold(text).length >= 2 ? { words: text } : null;
}

const likePattern = (words: string) => `%${fold(words).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type Holding = {
  characterId: number;
  characterName: string;
  characterClass: string | null;
  level: number | null;
  realm: string;
  location: "bags" | "bank" | "equipped";
  quantity: number;
  /** Variante portée ou rangée (suffixe « de l'aigle »…), quand elle diffère du nom de l'objet. */
  variant: string | null;
  /** Date du relevé du conteneur. */
  seenAt: Date | null;
};

export type ItemOwners = { itemId: number; name: string | null; quality: number | null; total: number; holdings: Holding[] };

/** Objets correspondant à la recherche, les plus détenus d'abord, avec chacun de leurs détenteurs. */
export async function searchItemOwners(db: DatabaseOrTransaction, query: ItemQuery): Promise<{ items: ItemOwners[]; truncated: boolean }> {
  let itemIds: number[];
  if ("itemId" in query) {
    itemIds = [query.itemId];
  } else {
    const pattern = likePattern(query.words);
    const [known, worn] = await Promise.all([
      db
        .selectDistinct({ itemId: t.items.itemId })
        .from(t.items)
        .where(sql`${foldColumn(t.items.name)} like ${pattern}`)
        .limit(MAX_MATCHES + 1),
      db
        .selectDistinct({ itemId: t.characterEquipment.itemId })
        .from(t.characterEquipment)
        .where(and(isNotNull(t.characterEquipment.itemId), sql`${foldColumn(t.characterEquipment.name)} like ${pattern}`))
        .limit(MAX_MATCHES + 1),
    ]);
    itemIds = [...new Set([...known, ...worn].map((row) => row.itemId).filter((id): id is number => id !== null))];
  }
  const truncated = itemIds.length > MAX_MATCHES;
  itemIds = itemIds.slice(0, MAX_MATCHES);
  if (itemIds.length === 0) return { items: [], truncated: false };

  const character = {
    characterId: t.characters.id,
    characterName: t.characters.name,
    characterClass: t.characters.class,
    level: t.characters.level,
    realm: t.realms.name,
  };
  const baseId = sql<number>`split_part(${t.characterItems.itemKey}, ':', 1)::int`;
  const [names, stored, worn] = await Promise.all([
    db
      .select({ itemKey: t.items.itemKey, itemId: t.items.itemId, suffixId: t.items.suffixId, name: t.items.name, quality: t.items.quality })
      .from(t.items)
      .where(inArray(t.items.itemId, itemIds))
      .orderBy(asc(t.items.itemKey)),
    db
      .select({
        ...character,
        itemId: baseId,
        itemKey: t.characterItems.itemKey,
        location: t.characterItems.location,
        quantity: t.characterItems.quantity,
        bagsAt: t.characters.bagsAt,
        bankAt: t.characters.bankAt,
      })
      .from(t.characterItems)
      .innerJoin(t.characters, sql`${t.characters.id} = ${t.characterItems.characterId}`)
      .innerJoin(t.realms, sql`${t.realms.id} = ${t.characters.realmId}`)
      .where(inArray(baseId, itemIds)),
    db
      .select({ ...character, itemId: t.characterEquipment.itemId, name: t.characterEquipment.name, quality: t.characterEquipment.quality, seenAt: t.characters.sourceLastSeenAt })
      .from(t.characterEquipment)
      .innerJoin(t.characters, sql`${t.characters.id} = ${t.characterEquipment.characterId}`)
      .innerJoin(t.realms, sql`${t.realms.id} = ${t.characters.realmId}`)
      .where(inArray(t.characterEquipment.itemId, itemIds)),
  ]);

  const byKey = new Map(names.map((row) => [row.itemKey, row]));
  const results = new Map<number, ItemOwners>(
    itemIds.map((itemId) => {
      // Le nom de référence est celui de l'objet sans suffixe, sinon le premier connu.
      const base = names.find((row) => row.itemId === itemId && row.suffixId === null) ?? names.find((row) => row.itemId === itemId);
      return [itemId, { itemId, name: base?.name ?? null, quality: base?.quality ?? null, total: 0, holdings: [] }];
    }),
  );
  const add = (itemId: number, holding: Holding) => {
    const item = results.get(itemId);
    if (!item) return;
    item.total += holding.quantity;
    item.holdings.push(holding);
  };

  for (const row of stored) {
    const item = results.get(row.itemId);
    const variantName = byKey.get(row.itemKey)?.name ?? null;
    if (item && item.name === null && variantName) item.name = variantName;
    add(row.itemId, {
      characterId: row.characterId,
      characterName: row.characterName,
      characterClass: row.characterClass,
      level: row.level,
      realm: row.realm,
      location: row.location === "bank" ? "bank" : "bags",
      quantity: row.quantity,
      variant: variantName && variantName !== item?.name ? variantName : null,
      seenAt: row.location === "bank" ? row.bankAt : row.bagsAt,
    });
  }
  for (const row of worn) {
    if (row.itemId === null) continue;
    const item = results.get(row.itemId);
    if (item && item.name === null) Object.assign(item, { name: row.name, quality: row.quality });
    add(row.itemId, {
      characterId: row.characterId,
      characterName: row.characterName,
      characterClass: row.characterClass,
      level: row.level,
      realm: row.realm,
      location: "equipped",
      quantity: 1,
      variant: row.name && row.name !== item?.name ? row.name : null,
      seenAt: row.seenAt,
    });
  }

  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
  const items = [...results.values()]
    // Un identifiant jamais vu nulle part n'apprend rien : il n'est pas listé.
    .filter((item) => item.name !== null || item.holdings.length > 0)
    .map((item) => ({ ...item, holdings: item.holdings.sort((a, b) => b.quantity - a.quantity || collator.compare(a.characterName, b.characterName)) }))
    .sort((a, b) => b.total - a.total || collator.compare(a.name ?? "", b.name ?? ""));
  return { items, truncated };
}
