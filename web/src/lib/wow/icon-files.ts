import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { type Fetch, latestBuild, networkError, parseCsv, readLimited, wagoGet } from "@/lib/economy/item-names";
import type { ItemName } from "@/lib/economy/load";
import type { Parsed } from "@/lib/settings/input";

// Noms des icônes du jeu. L'addon relève l'icône d'un objet par son identifiant de fichier
// (GetItemIcon) ; le CDN de Blizzard la sert par son nom (« inv_scroll_03 »). La correspondance
// vient de la table ManifestInterfaceData du client WoW Forever, publiée par wago.tools : environ
// 30 000 icônes sur 134 000 fichiers d'interface (8,8 Mo en version 1.60.1).

export const iconManifestUrl = (build: string) => `https://wago.tools/db2/ManifestInterfaceData/csv?build=${encodeURIComponent(build)}`;
/** Table Item : l'icône (IconFileDataID) de chaque objet du jeu, 1,4 Mo en version 1.60.1. */
export const itemTableUrl = (build: string) => `https://wago.tools/db2/Item/csv?build=${encodeURIComponent(build)}`;

export const MAX_MANIFEST_BYTES = 60 * 1024 * 1024;
export const MAX_ITEM_TABLE_BYTES = 20 * 1024 * 1024;
/** Plus lourd que la table des objets, plus lent à arriver : jusqu'à neuf minutes depuis un poste en novembre 2026. */
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;
const BATCH = 2_000;
const ICON_FOLDER = /^interface\\icons\\?$/i;
/** Seuls les noms simples font une adresse sûre ; les quelques noms à espace ou à point sont laissés de côté. */
const ICON_NAME = /^[a-z0-9_-]{1,100}$/;
const MAX_FILE_ID = 2_147_483_647;

export type IconFile = { fileId: number; name: string };

/** Icônes de la table ManifestInterfaceData : identifiant de fichier et nom en minuscules, sans extension. */
export function parseIconManifest(text: string): Parsed<IconFile[]> {
  const [header, ...rows] = parseCsv(text);
  const columns = { id: header?.indexOf("ID") ?? -1, path: header?.indexOf("FilePath") ?? -1, name: header?.indexOf("FileName") ?? -1 };
  if (columns.id < 0 || columns.path < 0 || columns.name < 0) {
    return { ok: false, error: "Fichier inattendu : les colonnes ID, FilePath et FileName sont absentes." };
  }
  const icons = new Map<number, string>();
  for (const row of rows) {
    if (!ICON_FOLDER.test(row[columns.path] ?? "")) continue;
    const id = row[columns.id] ?? "";
    const name = (row[columns.name] ?? "").trim().replace(/\.blp$/i, "").trim().toLowerCase();
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1 || Number(id) > MAX_FILE_ID || !ICON_NAME.test(name)) continue;
    if (!icons.has(Number(id))) icons.set(Number(id), name);
  }
  if (icons.size === 0) return { ok: false, error: "Fichier vide : aucune icône lisible." };
  return { ok: true, value: [...icons].map(([fileId, name]) => ({ fileId, name })) };
}

export type ItemIcon = { itemId: number; fileId: number };

/** Icône de chaque objet de la table Item ; un objet sans icône (0) est écarté. */
export function parseItemTable(text: string): Parsed<ItemIcon[]> {
  const [header, ...rows] = parseCsv(text);
  const columns = { id: header?.indexOf("ID") ?? -1, icon: header?.indexOf("IconFileDataID") ?? -1 };
  if (columns.id < 0 || columns.icon < 0) return { ok: false, error: "Fichier inattendu : les colonnes ID et IconFileDataID sont absentes." };
  const icons = new Map<number, number>();
  for (const row of rows) {
    const id = row[columns.id] ?? "";
    const icon = row[columns.icon] ?? "";
    if (!/^\d{1,10}$/.test(id) || !/^\d{1,10}$/.test(icon)) continue;
    const itemId = Number(id);
    const fileId = Number(icon);
    if (itemId < 1 || itemId > MAX_FILE_ID || fileId < 1 || fileId > MAX_FILE_ID || icons.has(itemId)) continue;
    icons.set(itemId, fileId);
  }
  if (icons.size === 0) return { ok: false, error: "Fichier vide : aucun objet lisible." };
  return { ok: true, value: [...icons].map(([itemId, fileId]) => ({ itemId, fileId })) };
}

export type IconImportResult =
  | { ok: true; build: string; count: number; items: number; removed: number; unchanged?: true }
  | { ok: false; error: string };

/** Icônes enregistrées : nombre et version du jeu dont elles viennent. */
export async function iconFilesSummary(db: Database): Promise<{ count: number; build: string | null }> {
  const [row] = await db.select({ count: sql<number>`count(*)::int`, build: sql<string | null>`max(${t.iconFiles.build})` }).from(t.iconFiles);
  return { count: row?.count ?? 0, build: row?.build ?? null };
}

/** Icônes des objets enregistrées : nombre et version du jeu dont elles viennent. */
export async function itemIconsSummary(db: Database): Promise<{ count: number; build: string | null }> {
  const [row] = await db.select({ count: sql<number>`count(*)::int`, build: sql<string | null>`max(${t.itemIcons.build})` }).from(t.itemIcons);
  return { count: row?.count ?? 0, build: row?.build ?? null };
}

/** Télécharge et lit un fichier de wago.tools ; un message d'erreur en cas d'échec. */
export async function downloadWago<T>(fetchImpl: Fetch, url: string, max: number, parse: (text: string) => Parsed<T>): Promise<Parsed<T>> {
  const response = await wagoGet(fetchImpl, url, DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) return response;
  let text: string | null;
  try {
    text = await readLimited(response.response, max);
  } catch (error) {
    return { ok: false, error: networkError(error) };
  }
  if (text === null) return { ok: false, error: `Fichier trop volumineux (plus de ${max / 1024 / 1024} Mo).` };
  return parse(text);
}

/**
 * Importe les noms d'icônes et l'icône de chaque objet de la dernière version du client. Les lignes
 * d'une version précédente absentes de la nouvelle sont supprimées. Tout ou rien. Avec onlyIfNewer,
 * rien n'est téléchargé quand cette version est déjà importée dans les deux tables (`unchanged`).
 */
export async function importIconFiles(db: Database, options: { now: Date; fetch?: Fetch; onlyIfNewer?: boolean }): Promise<IconImportResult> {
  const fetchImpl = options.fetch ?? fetch;
  const build = await latestBuild(fetchImpl);
  if (!build.ok) return build;

  if (options.onlyIfNewer) {
    const [files, items] = await Promise.all([iconFilesSummary(db), itemIconsSummary(db)]);
    if (files.count > 0 && files.build === build.value && items.count > 0 && items.build === build.value) {
      return { ok: true, build: build.value, count: files.count, items: items.count, removed: 0, unchanged: true };
    }
  }

  const manifest = await downloadWago(fetchImpl, iconManifestUrl(build.value), MAX_MANIFEST_BYTES, parseIconManifest);
  if (!manifest.ok) return manifest;
  const itemTable = await downloadWago(fetchImpl, itemTableUrl(build.value), MAX_ITEM_TABLE_BYTES, parseItemTable);
  if (!itemTable.ok) return itemTable;

  const removed = await db.transaction(async (tx) => {
    for (let start = 0; start < manifest.value.length; start += BATCH) {
      await tx
        .insert(t.iconFiles)
        .values(manifest.value.slice(start, start + BATCH).map((icon) => ({ ...icon, build: build.value, updatedAt: options.now })))
        .onConflictDoUpdate({ target: t.iconFiles.fileId, set: { name: sql`excluded.name`, build: sql`excluded.build`, updatedAt: sql`excluded.updated_at` } });
    }
    for (let start = 0; start < itemTable.value.length; start += BATCH) {
      await tx
        .insert(t.itemIcons)
        .values(itemTable.value.slice(start, start + BATCH).map((icon) => ({ ...icon, build: build.value, updatedAt: options.now })))
        .onConflictDoUpdate({ target: t.itemIcons.itemId, set: { fileId: sql`excluded.file_id`, build: sql`excluded.build`, updatedAt: sql`excluded.updated_at` } });
    }
    const gone = await tx.delete(t.iconFiles).where(sql`${t.iconFiles.build} <> ${build.value}`).returning({ fileId: t.iconFiles.fileId });
    await tx.delete(t.itemIcons).where(sql`${t.itemIcons.build} <> ${build.value}`);
    return gone.length;
  });
  return { ok: true, build: build.value, count: manifest.value.length, items: itemTable.value.length, removed };
}

/** Nom d'icône de chaque identifiant de fichier connu. */
export async function loadIconNames(db: Database, fileIds: Iterable<number>): Promise<Map<number, string>> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ fileId: t.iconFiles.fileId, name: t.iconFiles.name }).from(t.iconFiles).where(sql`${t.iconFiles.fileId} = any(${intArray(ids)})`);
  return new Map(rows.map((row) => [row.fileId, row.name]));
}

/** Liste d'entiers passée en un seul paramètre, quel que soit son nombre, convertie par PostgreSQL. */
export const intArray = (ids: readonly number[]) => sql`string_to_array(${ids.join(",")}, ',')::int[]`;

/**
 * Objet de la table Item désigné par une clé : « 1234 », « 1234:567 » (suffixe de l'addon, même
 * icône que l'objet de base) ou « g:1234:60 » (Auctionator). Null pour une mascotte (« p:… »).
 */
export function iconItemId(key: string): number | null {
  const match = /^(?:g:)?(\d{1,10})(?::\d{1,5})?$/.exec(key);
  if (!match) return null;
  const id = Number(match[1]);
  return id >= 1 && id <= MAX_FILE_ID ? id : null;
}

/**
 * Nom d'icône de chaque clé d'objet : celle relevée par l'addon (items.icon), sinon celle de la
 * table Item du jeu. Les clés sans icône connue sont absentes du résultat.
 */
export async function loadItemIcons(db: Database, keys: Iterable<string>): Promise<Map<string, string>> {
  // Une clé ne contient ni virgule ni espace : la liste passe en un seul paramètre.
  const unique = [...new Set(keys)].filter((key) => /^[\w:]{1,40}$/.test(key));
  if (unique.length === 0) return new Map();
  const addonRows = await db
    .select({ itemKey: t.items.itemKey, icon: t.items.icon })
    .from(t.items)
    .where(sql`${t.items.itemKey} = any(string_to_array(${unique.join(",")}, ','))`);
  const fileOf = new Map<string, number>();
  for (const row of addonRows) if (row.icon !== null) fileOf.set(row.itemKey, row.icon);

  const missing = new Map<number, string[]>();
  for (const key of unique) {
    if (fileOf.has(key)) continue;
    const id = iconItemId(key);
    if (id !== null) missing.set(id, [...(missing.get(id) ?? []), key]);
  }
  if (missing.size > 0) {
    const rows = await db
      .select({ itemId: t.itemIcons.itemId, fileId: t.itemIcons.fileId })
      .from(t.itemIcons)
      .where(sql`${t.itemIcons.itemId} = any(${intArray([...missing.keys()])})`);
    for (const row of rows) for (const key of missing.get(row.itemId) ?? []) fileOf.set(key, row.fileId);
  }

  const names = await loadIconNames(db, fileOf.values());
  const result = new Map<string, string>();
  for (const [key, fileId] of fileOf) {
    const name = names.get(fileId);
    if (name) result.set(key, name);
  }
  return result;
}

/**
 * Ajoute à names l'icône de chaque clé. Une clé sans nom reçoit une entrée sans nom ni qualité :
 * itemLabel et itemQuality se replient alors sur l'objet de base, comme avant.
 */
export async function attachItemIcons(db: Database, names: Map<string, ItemName>, keys: Iterable<string>): Promise<void> {
  const icons = await loadItemIcons(db, keys);
  for (const [key, icon] of icons) {
    const entry = names.get(key);
    names.set(key, entry ? { ...entry, icon } : { name: null, quality: null, icon });
  }
}
