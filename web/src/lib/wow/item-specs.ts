import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { catalogUrl, type Fetch, latestBuild, MAX_CATALOG_BYTES, parseCsv } from "@/lib/economy/item-names";
import type { Parsed } from "@/lib/settings/input";
import { classMask, type ItemSpec } from "./gear";
import { downloadWago, iconItemId, intArray, itemTableUrl, MAX_ITEM_TABLE_BYTES } from "./icon-files";

// Caractéristiques des objets, pour les catégories et les filtres d'équipement de la page
// Inventaires. La classe, la sous-classe et l'emplacement viennent de la table Item de WoW Forever,
// qui décrit tous les objets. Sa table ItemSparse ne contient qu'une partie des objets (le serveur
// envoie les autres au client) : les niveaux et les classes autorisées manquants viennent de la
// table ItemSparse de WoW Classic Era. Le 2026-11-13, 7 848 équipements sur 19 079 viennent de WoW
// Forever, 9 219 de Classic Era, et les deux s'accordent sur le niveau requis de 99 % des 5 720
// objets qu'elles partagent.

export const ERA_BUILD_URL = "https://wago.tools/api/builds/wow_classic_era/latest";
const BATCH = 2_000;
const MAX_ITEM_ID = 2_147_483_647;

export type ItemType = { itemId: number; itemClass: number; subclass: number; inventoryType: number };
export type ItemLevels = { itemLevel: number | null; requiredLevel: number | null; allowableClass: number | null; bonding: number | null };

const smallInt = (value: string | undefined, max = 32_767): number | null => {
  if (value === undefined || !/^-?\d{1,6}$/.test(value)) return null;
  const number = Number(value);
  return number >= 0 && number <= max ? number : null;
};

/** Objets de la table Item : classe, sous-classe (type d'armure, d'arme, de composant…) et emplacement. */
export function parseItemTypes(text: string): Parsed<ItemType[]> {
  const [header, ...rows] = parseCsv(text);
  const columns = {
    id: header?.indexOf("ID") ?? -1,
    itemClass: header?.indexOf("ClassID") ?? -1,
    subclass: header?.indexOf("SubclassID") ?? -1,
    inventoryType: header?.indexOf("InventoryType") ?? -1,
  };
  if (Object.values(columns).some((index) => index < 0)) {
    return { ok: false, error: "Fichier inattendu : les colonnes ID, ClassID, SubclassID et InventoryType sont absentes." };
  }
  const types = new Map<number, ItemType>();
  for (const row of rows) {
    const id = row[columns.id] ?? "";
    if (!/^\d{1,10}$/.test(id)) continue;
    const itemId = Number(id);
    const itemClass = smallInt(row[columns.itemClass], 99);
    const subclass = smallInt(row[columns.subclass], 99);
    const inventoryType = smallInt(row[columns.inventoryType], 99);
    if (itemId < 1 || itemId > MAX_ITEM_ID || itemClass === null || subclass === null || inventoryType === null || types.has(itemId)) continue;
    types.set(itemId, { itemId, itemClass, subclass, inventoryType });
  }
  if (types.size === 0) return { ok: false, error: "Fichier vide : aucun objet lisible." };
  return { ok: true, value: [...types.values()] };
}

/** Niveaux, classes autorisées et liaison de chaque objet d'une table ItemSparse (WoW Forever ou Classic Era). */
export function parseItemLevels(text: string): Parsed<Map<number, ItemLevels>> {
  const [header, ...rows] = parseCsv(text);
  const columns = {
    id: header?.indexOf("ID") ?? -1,
    itemLevel: header?.indexOf("ItemLevel") ?? -1,
    requiredLevel: header?.indexOf("RequiredLevel") ?? -1,
    allowableClass: header?.indexOf("AllowableClass") ?? -1,
    bonding: header?.indexOf("Bonding") ?? -1,
  };
  if (Object.values(columns).some((index) => index < 0)) {
    return { ok: false, error: "Fichier inattendu : les colonnes ID, ItemLevel, RequiredLevel, AllowableClass et Bonding sont absentes." };
  }
  const levels = new Map<number, ItemLevels>();
  for (const row of rows) {
    const id = row[columns.id] ?? "";
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1 || Number(id) > MAX_ITEM_ID || levels.has(Number(id))) continue;
    const allowable = row[columns.allowableClass] ?? "";
    levels.set(Number(id), {
      itemLevel: smallInt(row[columns.itemLevel], 1_000),
      requiredLevel: smallInt(row[columns.requiredLevel], 1_000),
      allowableClass: /^-?\d{1,11}$/.test(allowable) ? classMask(Number(allowable)) : null,
      bonding: smallInt(row[columns.bonding], 99),
    });
  }
  if (levels.size === 0) return { ok: false, error: "Fichier vide : aucun objet lisible." };
  return { ok: true, value: levels };
}

export type ItemSpecRow = ItemType & ItemLevels & { levelSource: "wowf" | "era" | null };

/** Type de WoW Forever, niveaux de WoW Forever sinon de Classic Era. */
export function mergeItemSpecs(types: readonly ItemType[], forever: ReadonlyMap<number, ItemLevels>, era: ReadonlyMap<number, ItemLevels>): ItemSpecRow[] {
  return types.map((type) => {
    const own = forever.get(type.itemId);
    if (own) return { ...type, ...own, levelSource: "wowf" };
    const fallback = era.get(type.itemId);
    if (fallback) return { ...type, ...fallback, levelSource: "era" };
    return { ...type, itemLevel: null, requiredLevel: null, allowableClass: null, bonding: null, levelSource: null };
  });
}

export type SpecsImportResult =
  | { ok: true; build: string; count: number; fromForever: number; fromEra: number; removed: number; unchanged?: true }
  | { ok: false; error: string };

/** Objets enregistrés : nombre, version (« WoW Forever/Classic Era ») et origine des niveaux. */
export async function itemSpecsSummary(db: Database): Promise<{ count: number; build: string | null; fromForever: number; fromEra: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      build: sql<string | null>`max(${t.itemSpecs.build})`,
      fromForever: sql<number>`(count(*) filter (where ${t.itemSpecs.levelSource} = 'wowf'))::int`,
      fromEra: sql<number>`(count(*) filter (where ${t.itemSpecs.levelSource} = 'era'))::int`,
    })
    .from(t.itemSpecs);
  return { count: row?.count ?? 0, build: row?.build ?? null, fromForever: row?.fromForever ?? 0, fromEra: row?.fromEra ?? 0 };
}

/** Niveaux qu'un import précédent a pris dans Classic Era. */
async function storedEraLevels(db: Database): Promise<Map<number, ItemLevels>> {
  const rows = await db
    .select({
      itemId: t.itemSpecs.itemId,
      itemLevel: t.itemSpecs.itemLevel,
      requiredLevel: t.itemSpecs.requiredLevel,
      allowableClass: t.itemSpecs.allowableClass,
      bonding: t.itemSpecs.bonding,
    })
    .from(t.itemSpecs)
    .where(sql`${t.itemSpecs.levelSource} = 'era'`);
  return new Map(rows.map(({ itemId, ...levels }) => [itemId, levels]));
}

/**
 * Importe les objets de la dernière version de WoW Forever, complétés par Classic Era. Les lignes
 * d'une version précédente absentes de la nouvelle sont supprimées. Tout ou rien. Avec onlyIfNewer,
 * rien n'est téléchargé quand ces deux versions sont déjà importées. Un échec de Classic Era laisse
 * un import complet en place. Sans import, ou quand les lignes en place sont à reprendre (version
 * vide, migration 0017), WoW Forever seul est importé, avec les niveaux déjà pris dans Classic Era.
 */
export async function importItemSpecs(db: Database, options: { now: Date; fetch?: Fetch; onlyIfNewer?: boolean }): Promise<SpecsImportResult> {
  const fetchImpl = options.fetch ?? fetch;
  const forever = await latestBuild(fetchImpl);
  if (!forever.ok) return forever;
  const era = await latestBuild(fetchImpl, ERA_BUILD_URL);
  const current = await itemSpecsSummary(db);
  // Version vide : lignes à reprendre (migration 0017), qui ne décrivent que l'équipement.
  const complete = current.count > 0 && current.build !== "";
  // Classic Era injoignable : on garde l'import complet déjà en place ; sinon WoW Forever seul
  // (build « <version>/ »), complété dès que Classic Era répond.
  if (!era.ok && complete) return era;
  const build = `${forever.value}/${era.ok ? era.value : ""}`;

  if (options.onlyIfNewer && current.count > 0 && current.build === build) {
    return { ok: true, build, count: current.count, fromForever: current.fromForever, fromEra: current.fromEra, removed: 0, unchanged: true };
  }

  const types = await downloadWago(fetchImpl, itemTableUrl(forever.value), MAX_ITEM_TABLE_BYTES, parseItemTypes);
  if (!types.ok) return types;
  const foreverLevels = await downloadWago(fetchImpl, catalogUrl(forever.value), MAX_CATALOG_BYTES, parseItemLevels);
  if (!foreverLevels.ok) return foreverLevels;
  const eraLevels = era.ok ? await downloadWago(fetchImpl, catalogUrl(era.value), MAX_CATALOG_BYTES, parseItemLevels) : null;
  if (eraLevels && !eraLevels.ok && complete) return eraLevels;
  // Sans Classic Era, les niveaux qu'il avait déjà donnés restent.
  const rows = mergeItemSpecs(types.value, foreverLevels.value, eraLevels?.ok ? eraLevels.value : await storedEraLevels(db));
  const storedBuild = eraLevels?.ok ? build : `${forever.value}/`;

  const removed = await db.transaction(async (tx) => {
    for (let start = 0; start < rows.length; start += BATCH) {
      await tx
        .insert(t.itemSpecs)
        .values(rows.slice(start, start + BATCH).map((row) => ({ ...row, build: storedBuild, updatedAt: options.now })))
        .onConflictDoUpdate({
          target: t.itemSpecs.itemId,
          set: {
            itemClass: sql`excluded.item_class`,
            subclass: sql`excluded.subclass`,
            inventoryType: sql`excluded.inventory_type`,
            itemLevel: sql`excluded.item_level`,
            requiredLevel: sql`excluded.required_level`,
            allowableClass: sql`excluded.allowable_class`,
            bonding: sql`excluded.bonding`,
            levelSource: sql`excluded.level_source`,
            build: sql`excluded.build`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    const gone = await tx.delete(t.itemSpecs).where(sql`${t.itemSpecs.build} <> ${storedBuild}`).returning({ itemId: t.itemSpecs.itemId });
    return gone.length;
  });
  return {
    ok: true,
    build: storedBuild,
    count: rows.length,
    fromForever: rows.filter((row) => row.levelSource === "wowf").length,
    fromEra: rows.filter((row) => row.levelSource === "era").length,
    removed,
  };
}

/** Caractéristiques de chaque clé d'objet connue de la table Item, variantes comprises. */
export async function loadItemSpecs(db: Database, keys: Iterable<string>): Promise<Map<string, ItemSpec>> {
  const byId = new Map<number, string[]>();
  for (const key of new Set(keys)) {
    const id = iconItemId(key);
    if (id !== null) byId.set(id, [...(byId.get(id) ?? []), key]);
  }
  if (byId.size === 0) return new Map();
  const rows = await db
    .select({
      itemId: t.itemSpecs.itemId,
      itemClass: t.itemSpecs.itemClass,
      subclass: t.itemSpecs.subclass,
      inventoryType: t.itemSpecs.inventoryType,
      itemLevel: t.itemSpecs.itemLevel,
      requiredLevel: t.itemSpecs.requiredLevel,
      allowableClass: t.itemSpecs.allowableClass,
      bonding: t.itemSpecs.bonding,
    })
    .from(t.itemSpecs)
    .where(sql`${t.itemSpecs.itemId} = any(${intArray([...byId.keys()])})`);
  const specs = new Map<string, ItemSpec>();
  for (const { itemId, ...spec } of rows) {
    for (const key of byId.get(itemId) ?? []) specs.set(key, spec);
  }
  return specs;
}
