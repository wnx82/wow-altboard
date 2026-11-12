import { inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { type Fetch, latestBuild, networkError, parseCsv, readLimited, wagoGet } from "@/lib/economy/item-names";
import type { Parsed } from "@/lib/settings/input";

// Noms des icônes du jeu. L'addon relève l'icône d'un objet par son identifiant de fichier
// (GetItemIcon) ; le CDN de Blizzard la sert par son nom (« inv_scroll_03 »). La correspondance
// vient de la table ManifestInterfaceData du client WoW Forever, publiée par wago.tools : environ
// 30 000 icônes sur 134 000 fichiers d'interface (8,8 Mo en version 1.60.1).

export const iconManifestUrl = (build: string) => `https://wago.tools/db2/ManifestInterfaceData/csv?build=${encodeURIComponent(build)}`;

export const MAX_MANIFEST_BYTES = 60 * 1024 * 1024;
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

export type IconImportResult = { ok: true; build: string; count: number; removed: number; unchanged?: true } | { ok: false; error: string };

/** Icônes enregistrées : nombre et version du jeu dont elles viennent. */
export async function iconFilesSummary(db: Database): Promise<{ count: number; build: string | null }> {
  const [row] = await db.select({ count: sql<number>`count(*)::int`, build: sql<string | null>`max(${t.iconFiles.build})` }).from(t.iconFiles);
  return { count: row?.count ?? 0, build: row?.build ?? null };
}

/**
 * Importe les noms d'icônes de la dernière version du client. Les icônes d'une version précédente
 * absentes de la nouvelle sont supprimées. Tout ou rien. Avec onlyIfNewer, rien n'est téléchargé
 * quand cette version est déjà importée (`unchanged`).
 */
export async function importIconFiles(db: Database, options: { now: Date; fetch?: Fetch; onlyIfNewer?: boolean }): Promise<IconImportResult> {
  const fetchImpl = options.fetch ?? fetch;
  const build = await latestBuild(fetchImpl);
  if (!build.ok) return build;

  if (options.onlyIfNewer) {
    const current = await iconFilesSummary(db);
    if (current.count > 0 && current.build === build.value) return { ok: true, build: build.value, count: current.count, removed: 0, unchanged: true };
  }

  const download = await wagoGet(fetchImpl, iconManifestUrl(build.value), DOWNLOAD_TIMEOUT_MS);
  if (!download.ok) return download;
  let text: string | null;
  try {
    text = await readLimited(download.response, MAX_MANIFEST_BYTES);
  } catch (error) {
    return { ok: false, error: networkError(error) };
  }
  if (text === null) return { ok: false, error: `Fichier trop volumineux (plus de ${MAX_MANIFEST_BYTES / 1024 / 1024} Mo).` };
  const parsed = parseIconManifest(text);
  if (!parsed.ok) return parsed;

  const removed = await db.transaction(async (tx) => {
    for (let start = 0; start < parsed.value.length; start += BATCH) {
      await tx
        .insert(t.iconFiles)
        .values(parsed.value.slice(start, start + BATCH).map((icon) => ({ ...icon, build: build.value, updatedAt: options.now })))
        .onConflictDoUpdate({ target: t.iconFiles.fileId, set: { name: sql`excluded.name`, build: sql`excluded.build`, updatedAt: sql`excluded.updated_at` } });
    }
    const gone = await tx.delete(t.iconFiles).where(sql`${t.iconFiles.build} <> ${build.value}`).returning({ fileId: t.iconFiles.fileId });
    return gone.length;
  });
  return { ok: true, build: build.value, count: parsed.value.length, removed };
}

/** Nom d'icône de chaque identifiant de fichier connu. */
export async function loadIconNames(db: Database, fileIds: Iterable<number>): Promise<Map<number, string>> {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.select({ fileId: t.iconFiles.fileId, name: t.iconFiles.name }).from(t.iconFiles).where(inArray(t.iconFiles.fileId, ids));
  return new Map(rows.map((row) => [row.fileId, row.name]));
}
