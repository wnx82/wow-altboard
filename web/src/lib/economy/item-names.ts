import { inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import type { Parsed } from "@/lib/settings/input";
import type { ItemName } from "./load";

// Noms des objets qu'aucun personnage n'a possédés. L'addon ne nomme que les objets vus dans les
// sacs, la banque ou l'équipement ; Auctionator et les recettes citent tous les autres par leur seul
// identifiant. Le repli vient de la table ItemSparse du jeu, publiée par wago.tools pour chaque
// version du client WoW Forever (produit « wowf »), en français.

export const WAGO_PRODUCT = "wowf";
export const CATALOG_LOCALE = "frFR";
export const BUILD_URL = `https://wago.tools/api/builds/${WAGO_PRODUCT}/latest`;
export const catalogUrl = (build: string) => `https://wago.tools/db2/ItemSparse/csv?build=${encodeURIComponent(build)}&locale=${CATALOG_LOCALE}`;

/** Le fichier de la version 1.60.1 pèse 5,5 Mo : au-delà de cette taille, la réponse est refusée. */
export const MAX_CATALOG_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
/** Le fichier a mis près de deux minutes à arriver sur le serveur de production (novembre 2026). */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const BATCH = 1_000;
const BUILD_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,7}$/;
const MAX_NAME_LENGTH = 200;
const MAX_ITEM_ID = 2_147_483_647;

export type CatalogEntry = { itemId: number; name: string; quality: number | null };

/** CSV RFC 4180 : champs entre guillemets, guillemets doublés, virgules et sauts de ligne dans un champ. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Identifiant, nom et qualité de chaque objet de la table ItemSparse ; les lignes illisibles sont ignorées. */
export function parseItemSparse(text: string): Parsed<CatalogEntry[]> {
  const [header, ...rows] = parseCsv(text);
  const columns = { id: header?.indexOf("ID") ?? -1, name: header?.indexOf("Display_lang") ?? -1, quality: header?.indexOf("OverallQualityID") ?? -1 };
  if (columns.id < 0 || columns.name < 0 || columns.quality < 0) {
    return { ok: false, error: "Fichier inattendu : les colonnes ID, Display_lang et OverallQualityID sont absentes." };
  }
  const entries: CatalogEntry[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const id = row[columns.id] ?? "";
    // Caractères de contrôle retirés : PostgreSQL refuse l'octet nul dans un texte.
    const name = (row[columns.name] ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    const quality = row[columns.quality] ?? "";
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1 || Number(id) > MAX_ITEM_ID || seen.has(Number(id))) continue;
    if (name === "" || name.length > MAX_NAME_LENGTH) continue;
    seen.add(Number(id));
    entries.push({ itemId: Number(id), name, quality: /^[0-9]$/.test(quality) ? Number(quality) : null });
  }
  if (entries.length === 0) return { ok: false, error: "Fichier vide : aucun nom d'objet lisible." };
  return { ok: true, value: entries };
}

/** Corps d'une réponse, lu par morceaux : arrêté dès qu'il dépasse max octets. */
async function readLimited(response: Response, max: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

type Fetch = typeof globalThis.fetch;

/** Message lisible d'un échec réseau : délai dépassé, adresse introuvable, connexion refusée. */
function networkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  const name = (error as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "wago.tools ne répond pas (délai dépassé).";
  return `wago.tools injoignable${cause ? ` (${cause})` : ""}.`;
}

async function get(fetchImpl: Fetch, url: string, timeoutMs = TIMEOUT_MS): Promise<{ ok: true; response: Response } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": "wow-altboard" }, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (!response.ok) return { ok: false, error: `wago.tools a répondu ${response.status}.` };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error: networkError(error) };
  }
}

/** Version la plus récente du client publiée par wago.tools. */
export async function latestBuild(fetchImpl: Fetch = fetch): Promise<Parsed<string>> {
  const result = await get(fetchImpl, BUILD_URL);
  if (!result.ok) return result;
  const body = (await readLimited(result.response, 64 * 1024).catch(() => null)) ?? "";
  let version: unknown;
  try {
    version = (JSON.parse(body) as { version?: unknown }).version;
  } catch {
    version = undefined;
  }
  if (typeof version !== "string" || !BUILD_PATTERN.test(version)) return { ok: false, error: "Version du jeu illisible dans la réponse de wago.tools." };
  return { ok: true, value: version };
}

export type ImportResult = { ok: true; build: string; count: number; removed: number; unchanged?: true } | { ok: false; error: string };

/**
 * Importe les noms de la dernière version : un nom « wago » est remplacé, un nom « client » jamais.
 * Les noms « wago » d'une version précédente absents de la nouvelle sont supprimés. Tout ou rien.
 * Avec onlyIfNewer, rien n'est téléchargé quand cette version est déjà importée (`unchanged`).
 */
export async function importItemNames(db: Database, options: { now: Date; fetch?: Fetch; onlyIfNewer?: boolean }): Promise<ImportResult> {
  const fetchImpl = options.fetch ?? fetch;
  const build = await latestBuild(fetchImpl);
  if (!build.ok) return build;

  if (options.onlyIfNewer) {
    const current = (await catalogSummary(db)).wago;
    if (current.count > 0 && current.build === build.value) return { ok: true, build: build.value, count: current.count, removed: 0, unchanged: true };
  }

  const download = await get(fetchImpl, catalogUrl(build.value), DOWNLOAD_TIMEOUT_MS);
  if (!download.ok) return download;
  let text: string | null;
  try {
    text = await readLimited(download.response, MAX_CATALOG_BYTES);
  } catch (error) {
    return { ok: false, error: networkError(error) };
  }
  if (text === null) return { ok: false, error: `Fichier trop volumineux (plus de ${MAX_CATALOG_BYTES / 1024 / 1024} Mo).` };
  const parsed = parseItemSparse(text);
  if (!parsed.ok) return parsed;

  const removed = await db.transaction(async (tx) => {
    for (let start = 0; start < parsed.value.length; start += BATCH) {
      await tx
        .insert(t.itemNames)
        .values(parsed.value.slice(start, start + BATCH).map((entry) => ({ ...entry, source: "wago", build: build.value, updatedAt: options.now })))
        .onConflictDoUpdate({
          target: t.itemNames.itemId,
          set: { name: sql`excluded.name`, quality: sql`excluded.quality`, build: sql`excluded.build`, updatedAt: sql`excluded.updated_at` },
          setWhere: sql`${t.itemNames.source} = 'wago'`,
        });
    }
    const gone = await tx
      .delete(t.itemNames)
      .where(sql`${t.itemNames.source} = 'wago' and ${t.itemNames.build} <> ${build.value}`)
      .returning({ itemId: t.itemNames.itemId });
    return gone.length;
  });
  return { ok: true, build: build.value, count: parsed.value.length, removed };
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type ClientNames = { locale: string; build: number; names: readonly { id: number; name: string }[] };

/**
 * Noms lus par l'agent dans le cache local du jeu (DBCache.bin) : ceux que le serveur du jeu a
 * envoyés au client, correctifs compris, plus récents que la table publiée par wago.tools. Ils
 * remplacent tout nom existant ; la qualité déjà connue est gardée. Seule la langue du site est
 * retenue. Renvoie le nombre de noms ajoutés ou modifiés.
 */
export async function storeClientNames(tx: Transaction, entries: readonly ClientNames[], now: Date): Promise<number> {
  const names = new Map<number, { name: string; build: string }>();
  for (const entry of entries) {
    if (entry.locale !== CATALOG_LOCALE) continue;
    for (const { id, name } of entry.names) {
      const trimmed = name.trim();
      if (id >= 1 && id <= MAX_ITEM_ID && trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH) names.set(id, { name: trimmed, build: String(entry.build) });
    }
  }

  let stored = 0;
  const rows = [...names].map(([itemId, value]) => ({ itemId, name: value.name, quality: null, source: "client", build: value.build, updatedAt: now }));
  for (let start = 0; start < rows.length; start += BATCH) {
    const changed = await tx
      .insert(t.itemNames)
      .values(rows.slice(start, start + BATCH))
      .onConflictDoUpdate({
        target: t.itemNames.itemId,
        set: { name: sql`excluded.name`, source: sql`excluded.source`, build: sql`excluded.build`, updatedAt: sql`excluded.updated_at` },
        setWhere: sql`(${t.itemNames.name}, ${t.itemNames.source}, ${t.itemNames.build}) is distinct from (excluded.name, excluded.source, excluded.build)`,
      })
      .returning({ itemId: t.itemNames.itemId });
    stored += changed.length;
  }
  return stored;
}

export type CatalogSummary = { source: "wago" | "client"; count: number; build: string | null; updatedAt: Date | null };

/** Noms enregistrés par source : nombre, version la plus récente, date du dernier import. */
export async function catalogSummary(db: Database): Promise<Record<"wago" | "client", CatalogSummary>> {
  const rows = await db
    .select({
      source: t.itemNames.source,
      count: sql<number>`count(*)::int`,
      build: sql<string | null>`max(${t.itemNames.build})`,
      updatedAt: sql<Date | null>`max(${t.itemNames.updatedAt})`,
    })
    .from(t.itemNames)
    .groupBy(t.itemNames.source);
  const of = (source: "wago" | "client"): CatalogSummary => {
    const row = rows.find((entry) => entry.source === source);
    return { source, count: row?.count ?? 0, build: row?.build ?? null, updatedAt: row?.updatedAt ? new Date(row.updatedAt) : null };
  };
  return { wago: of("wago"), client: of("client") };
}

/**
 * Identifiant d'objet d'une clé « 1234 » ou « g:1234:60 » (Auctionator). Ni une mascotte
 * (« p:… », identifiant d'espèce), ni une clé à suffixe de l'addon (« 1234:567 ») : leur nombre
 * désignerait un autre objet.
 */
function catalogId(key: string): number | null {
  const match = /^(?:g:)?(\d{1,10})(?::\d{1,5})?$/.exec(key);
  if (!match || (key.includes(":") && !key.startsWith("g:"))) return null;
  const id = Number(match[1]);
  return id >= 1 && id <= MAX_ITEM_ID ? id : null;
}

/**
 * Complète names avec les noms du jeu, pour les clés qui n'en ont pas : le nom est rangé sous
 * l'identifiant de base, où itemLabel le trouve aussi pour « g:1234:60 ».
 */
export async function fillCatalogNames(db: Database, names: Map<string, ItemName>, keys: Iterable<string>): Promise<void> {
  const ids = new Set<number>();
  for (const key of keys) {
    const id = catalogId(key);
    if (id === null || names.get(key)?.name || names.get(String(id))?.name) continue;
    ids.add(id);
  }
  if (ids.size === 0) return;
  // Un seul paramètre, quel que soit le nombre d'objets : la liste passe en texte, convertie par PostgreSQL.
  const rows = await db
    .select({ itemId: t.itemNames.itemId, name: t.itemNames.name, quality: t.itemNames.quality })
    .from(t.itemNames)
    .where(sql`${t.itemNames.itemId} = any(string_to_array(${[...ids].join(",")}, ',')::int[])`);
  for (const row of rows) {
    const key = String(row.itemId);
    names.set(key, { name: row.name, quality: names.get(key)?.quality ?? row.quality });
  }
}

/** Noms de quelques objets : ceux relevés par l'addon, complétés par les noms du jeu. */
export async function loadItemNames(db: Database, keys: readonly string[]): Promise<Map<string, ItemName>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ itemKey: t.items.itemKey, name: t.items.name, quality: t.items.quality }).from(t.items).where(inArray(t.items.itemKey, unique));
  const names = new Map(rows.map((row) => [row.itemKey, { name: row.name, quality: row.quality }]));
  await fillCatalogNames(db, names, unique);
  return names;
}
