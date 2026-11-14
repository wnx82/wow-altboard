import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { type Fetch, readLimited } from "@/lib/economy/item-names";
import { enchantText, parseWowheadTooltip, type TooltipLine } from "./wowhead-tooltip";

// Bulles d'objets à la manière de Wowhead : dégâts, vitesse, armure, caractéristiques, effets,
// ensemble, durabilité, prix de vente. Les tables du jeu publiées par wago.tools ne suffisent pas :
// WoW Forever change une partie de l'itemisation côté serveur. Wowhead la relève : sa base WoW
// Forever (dataEnv 16) répond en français (locale 2). Seul l'identifiant de l'objet lui est envoyé.
// Chaque bulle est lue à la première demande puis gardée en base, relue au bout de FRESH_DAYS.

export const WOWHEAD_DATA_ENV = 16;
export const WOWHEAD_LOCALE = 2;
const FRESH_MS = 30 * 24 * 60 * 60 * 1000;
/** Objet inconnu de Wowhead : redemandé après ce délai, le temps qu'il soit relevé. */
const MISSING_RETRY_MS = 3 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 256 * 1024;
/** Lectures simultanées chez Wowhead, toutes demandes confondues. */
const MAX_CONCURRENT = 3;

export const tooltipUrl = (itemId: number, suffix: number | null, enchant: number | null = null) =>
  `https://nether.wowhead.com/tooltip/item/${itemId}?dataEnv=${WOWHEAD_DATA_ENV}&locale=${WOWHEAD_LOCALE}${suffix === null ? "" : `&rand=${suffix}`}${
    enchant === null ? "" : `&ench=${enchant}`
  }`;

/** Clé d'un objet porté : l'identifiant, suivi de « e » et de l'enchantement quand il y en a un (« 2969e24 »). */
export const equippedItemKey = (itemId: number, enchantId: number | null) => (enchantId === null || enchantId === 0 ? String(itemId) : `${itemId}e${enchantId}`);

export type TooltipTarget = { key: string; itemId: number; suffix: number | null; enchant: number | null };

/**
 * Clé de cache d'une clé d'objet : « 1234 », « 1234:567 » (suffixe aléatoire relevé par l'addon),
 * « 2969e24 » (objet porté et son enchantement) ; « g:1234:60 » (Auctionator) désigne l'objet de
 * base. Null pour une mascotte (« p:… ») ou une clé illisible.
 */
export function tooltipKey(itemKey: string): TooltipTarget | null {
  const auction = /^g:(\d{1,10})(?::\d{1,5})?$/.exec(itemKey);
  const own = /^(\d{1,10})(?::(\d{1,7}))?(?:e(\d{1,6}))?$/.exec(itemKey);
  const itemId = Number(auction?.[1] ?? own?.[1] ?? Number.NaN);
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 2_147_483_647) return null;
  const read = (value: string | undefined) => (auction || value === undefined || Number(value) === 0 ? null : Number(value));
  const suffix = read(own?.[2]);
  const enchant = read(own?.[3]);
  const key = `${itemId}${suffix === null ? "" : `:${suffix}`}${enchant === null ? "" : `e${enchant}`}`;
  return { key, itemId, suffix, enchant };
}

export type ItemTooltip = { status: "ok" | "missing"; lines: TooltipLine[]; fetchedAt: Date } | { status: "unavailable" };

const responseSchema = z.object({ tooltip: z.string().max(MAX_BYTES) });

type Fetched = { ok: true; lines: TooltipLine[] } | { ok: true; missing: true } | { ok: false; error: string };

/** Bulle d'un objet chez Wowhead ; « missing » quand Wowhead ne le connaît pas. */
export async function fetchWowheadTooltip(fetchImpl: Fetch, itemId: number, suffix: number | null, enchant: number | null = null): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetchImpl(tooltipUrl(itemId, suffix, enchant), {
      headers: { accept: "application/json", "user-agent": "wow-altboard" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "Wowhead ne répond pas (délai dépassé)." : "Wowhead injoignable." };
  }
  if (response.status === 404) return { ok: true, missing: true };
  if (!response.ok) return { ok: false, error: `Wowhead a répondu ${response.status}.` };
  const body = await readLimited(response, MAX_BYTES).catch(() => null);
  if (body === null) return { ok: false, error: "Réponse de Wowhead trop volumineuse ou interrompue." };
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, error: "Réponse de Wowhead illisible." };
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Réponse de Wowhead inattendue." };
  const lines = parseWowheadTooltip(parsed.data.tooltip);
  return lines.length === 0 ? { ok: true, missing: true } : { ok: true, lines };
}

// Une même bulle demandée deux fois pendant sa lecture n'est lue qu'une fois.
const inflight = new Map<string, Promise<ItemTooltip>>();
let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

// Échec de lecture (Wowhead injoignable) : pas de nouvel essai pour cet objet avant FAILURE_PAUSE_MS.
const FAILURE_PAUSE_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5_000;
const failedUntil = new Map<string, number>();
function remember(key: string, now: Date) {
  if (failedUntil.size >= MAX_FAILURES) failedUntil.clear();
  failedUntil.set(key, now.getTime() + FAILURE_PAUSE_MS);
}

/** Oublie les échecs récents (tests). */
export function resetTooltipFailures() {
  failedUntil.clear();
}

const isFresh = (row: { status: string; fetchedAt: Date }, now: Date) =>
  now.getTime() - row.fetchedAt.getTime() < (row.status === "ok" ? FRESH_MS : MISSING_RETRY_MS);

/**
 * Bulle d'un objet : celle gardée en base tant qu'elle est récente, sinon relue chez Wowhead puis
 * enregistrée. Wowhead injoignable : la bulle gardée, même ancienne, sinon « unavailable ».
 */
export async function getItemTooltip(db: Database, itemKey: string, options: { now: Date; fetch?: Fetch }): Promise<ItemTooltip> {
  const target = tooltipKey(itemKey);
  if (!target) return { status: "unavailable" };
  const [stored] = await db.select().from(t.itemTooltips).where(eq(t.itemTooltips.itemKey, target.key));
  const kept: ItemTooltip | null = stored ? { status: stored.status === "ok" ? "ok" : "missing", lines: stored.lines, fetchedAt: stored.fetchedAt } : null;
  if (stored && kept && isFresh(stored, options.now)) return kept;

  const pending = inflight.get(target.key);
  if (pending) return pending;
  if ((failedUntil.get(target.key) ?? 0) > options.now.getTime()) return kept ?? { status: "unavailable" };
  const work = limited(async (): Promise<ItemTooltip> => {
    const fetched = await fetchWowheadTooltip(options.fetch ?? fetch, target.itemId, target.suffix, target.enchant);
    if (!fetched.ok) {
      remember(target.key, options.now);
      return kept ?? { status: "unavailable" };
    }
    failedUntil.delete(target.key);
    // Objet disparu de Wowhead : l'ancienne bulle vaut mieux que rien.
    const row =
      "lines" in fetched
        ? { status: "ok" as const, lines: fetched.lines }
        : kept?.status === "ok"
          ? { status: "ok" as const, lines: kept.lines }
          : { status: "missing" as const, lines: [] };
    await db
      .insert(t.itemTooltips)
      .values({ itemKey: target.key, ...row, fetchedAt: options.now })
      .onConflictDoUpdate({ target: t.itemTooltips.itemKey, set: { status: row.status, lines: row.lines, fetchedAt: options.now } });
    return { ...row, fetchedAt: options.now };
  }).finally(() => inflight.delete(target.key));
  inflight.set(target.key, work);
  return work;
}

/**
 * Effet d'un enchantement porté (« Intelligence +2 »), lu dans la bulle de l'objet enchanté : les
 * tables du jeu ne sont pas importées ici. Null quand Wowhead ne le donne pas.
 */
export async function getEnchantText(db: Database, itemId: number, enchantId: number, options: { now: Date; fetch?: Fetch }): Promise<string | null> {
  const tooltip = await getItemTooltip(db, equippedItemKey(itemId, enchantId), options);
  return tooltip.status === "ok" ? enchantText(tooltip.lines) : null;
}
