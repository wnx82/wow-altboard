import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { readSettings } from "@/lib/settings/store";
import { DEFAULT_CRAFT_OPTIONS, evaluateRecipe, type CraftEvaluation, type Recipe } from "./craft";
import { addDays, todayInBrussels } from "./days";
import { farmSignal, type FarmSignal } from "./farm";
import { attachItemIcons } from "@/lib/wow/icon-files";
import { fillCatalogNames } from "./item-names";
import { computeItemStats, type DayObservation, type ItemStats } from "./prices";

// Lecture des relevés en base et calcul complet du moteur pour un hôtel des ventes. Nombre fixe
// de requêtes, quel que soit le nombre d'objets.

export type MarketSummary = {
  id: number;
  flavor: string;
  auctionKey: string;
  label: string;
  lastDay: string | null;
  imports: number;
  lastReceivedAt: Date | null;
};

/** icon : nom de fichier de l'icône (« inv_scroll_03 »), quand il est connu. */
export type ItemName = { name: string | null; quality: number | null; icon?: string | null };

/** Quantité d'un objet chez un personnage : total, dont sacs et banque. */
export type Holding = { characterId: number; characterName: string; characterClass: string | null; quantity: number; bags: number; bank: number };

export type KnownRecipe = Recipe & { characters: { id: number; name: string; class: string | null }[] };

export type EconomyContext = {
  market: MarketSummary;
  markets: MarketSummary[];
  today: string;
  historyFrom: string | null;
  auctionCut: number;
  stats: Map<string, ItemStats>;
  /** Relevés journaliers de la fenêtre lue, du plus ancien au plus récent. */
  days: Map<string, DayObservation[]>;
  names: Map<string, ItemName>;
  vendor: Map<string, number>;
  stock: Map<string, number>;
  holdings: Map<string, Holding[]>;
  recipes: KnownRecipe[];
  crafts: CraftEvaluation[];
  /** Nom de chaque métier (ligne de compétence), tel que le jeu le donne. */
  professions: Map<number, string>;
  farmSignals: FarmSignal[];
  /** Relevé le plus frais du marché (dernier jour, puis fichier le plus récent). */
  lastImport: { id: number; receivedAt: Date; fileModifiedAt: Date; lastDay: string | null } | null;
  /** Dernier relevé reçu, quel qu'il soit : tout nouvel import change la base des calculs. */
  newestImportId: number | null;
  lastSyncRunId: number | null;
};

/** Fenêtre lue pour les statistiques : 30 jours, plus 30 pour la variation sur 30 jours. */
const WINDOW_DAYS = 60;

export const flavorLabel = (flavor: string) => (flavor === "_forever_" ? "WoW Forever" : flavor === "_classic_beta_" ? "bêta" : flavor);

/** Base d'un objet : « 1234 » pour « 1234 », « g:1234:60 » ou « p:1234 ». */
export function baseItemKey(itemKey: string): string {
  const parts = itemKey.split(":");
  return parts.length === 1 ? itemKey : parts[1];
}

export function itemLabel(names: ReadonlyMap<string, ItemName>, itemKey: string): string {
  const name = names.get(itemKey)?.name ?? names.get(baseItemKey(itemKey))?.name;
  const level = itemKey.startsWith("g:") ? ` (niveau ${itemKey.split(":")[2]})` : "";
  return name ? `${name}${level}` : `Objet ${baseItemKey(itemKey)}${level}`;
}

/** Qualité d'un objet, celle de sa base à défaut (« g:1234:60 » prend celle de « 1234 »). */
export function itemQuality(names: ReadonlyMap<string, ItemName>, itemKey: string): number | null {
  return names.get(itemKey)?.quality ?? names.get(baseItemKey(itemKey))?.quality ?? null;
}

export async function listMarkets(db: Database): Promise<MarketSummary[]> {
  const rows = await db
    .select({
      id: t.markets.id,
      flavor: t.markets.flavor,
      auctionKey: t.markets.auctionKey,
      lastDay: sql<string | null>`max(${t.marketImports.lastDay})::text`,
      imports: sql<number>`count(${t.marketImports.id})::int`,
      lastReceivedAt: sql<Date | null>`max(${t.marketImports.receivedAt})`,
    })
    .from(t.markets)
    .leftJoin(t.marketImports, eq(t.marketImports.marketId, t.markets.id))
    .groupBy(t.markets.id);
  return rows
    .map((row) => ({
      ...row,
      lastReceivedAt: row.lastReceivedAt ? new Date(row.lastReceivedAt) : null,
      label: `${row.auctionKey} · ${flavorLabel(row.flavor)}`,
    }))
    .sort((a, b) => (b.lastDay ?? "").localeCompare(a.lastDay ?? "") || a.id - b.id);
}

/** Premier jour pris en compte : le réglage, sinon la date limite de la réinitialisation des personnages. */
export function historyStart(settings: { marketHistoryFrom: Date | null; charactersCutoffAt: Date | null }): string | null {
  const from = settings.marketHistoryFrom ?? settings.charactersCutoffAt;
  return from ? todayInBrussels(from) : null;
}

/**
 * Détenteurs de chaque objet (sacs et banques relevés), le plus gros stock d'abord. Sans liste :
 * tous les objets possédés.
 */
export async function loadHoldings(db: Database, itemKeys?: readonly string[]): Promise<Map<string, Holding[]>> {
  const holdings = new Map<string, Holding[]>();
  if (itemKeys?.length === 0) return holdings;
  const rows = await db
    .select({
      itemKey: t.characterItems.itemKey,
      location: t.characterItems.location,
      characterId: t.characters.id,
      characterName: t.characters.name,
      characterClass: t.characters.class,
      quantity: sql<number>`sum(${t.characterItems.quantity})::int`,
    })
    .from(t.characterItems)
    .innerJoin(t.characters, eq(t.characters.id, t.characterItems.characterId))
    .where(itemKeys ? inArray(t.characterItems.itemKey, [...new Set(itemKeys)]) : undefined)
    .groupBy(t.characterItems.itemKey, t.characterItems.location, t.characters.id);
  for (const row of rows) {
    const list = holdings.get(row.itemKey) ?? [];
    let holding = list.find((entry) => entry.characterId === row.characterId);
    if (!holding) {
      holding = { characterId: row.characterId, characterName: row.characterName, characterClass: row.characterClass, quantity: 0, bags: 0, bank: 0 };
      list.push(holding);
    }
    holding.quantity += row.quantity;
    if (row.location === "bank") holding.bank += row.quantity;
    else holding.bags += row.quantity;
    holdings.set(row.itemKey, list);
  }
  for (const list of holdings.values()) list.sort((a, b) => b.quantity - a.quantity || a.characterName.localeCompare(b.characterName));
  return holdings;
}

/** Jours lus pour les statistiques : la fenêtre, sans rien d'antérieur au début de l'historique. */
function statsWindow(settings: { marketHistoryFrom: Date | null; charactersCutoffAt: Date | null }, now: Date) {
  const historyFrom = historyStart(settings);
  const today = todayInBrussels(now);
  const windowStart = addDays(today, -WINDOW_DAYS);
  return { historyFrom, today, from: historyFrom && historyFrom > windowStart ? historyFrom : windowStart };
}

/** Contexte complet, ou null tant qu'aucun prix n'a été reçu. */
export async function loadEconomy(db: Database, options: { marketId?: number; now: Date }): Promise<EconomyContext | null> {
  const markets = await listMarkets(db);
  const market = markets.find((m) => m.id === options.marketId) ?? markets.find((m) => m.lastDay !== null) ?? markets[0];
  if (!market) return null;

  const settings = await readSettings(db);
  const { historyFrom, today, from } = statsWindow(settings, options.now);
  const auctionCut = (settings.auctionCutPercent ?? 5) / 100;

  const [dayRows, latestRows, vendorRows, itemRows, holdings, recipeRows, reagentRows, knownRows, lastImportRows, lastRun, professionRows, newestImport] = await Promise.all([
    db
      .select({ itemKey: t.marketItemDays.itemKey, day: t.marketItemDays.day, low: t.marketItemDays.lowCopper, high: t.marketItemDays.highCopper, available: t.marketItemDays.available })
      .from(t.marketItemDays)
      .where(and(eq(t.marketItemDays.marketId, market.id), gte(t.marketItemDays.day, from))),
    db
      .select({ itemKey: t.marketItemLatest.itemKey, minCopper: t.marketItemLatest.minCopper, day: t.marketItemLatest.day })
      .from(t.marketItemLatest)
      .where(eq(t.marketItemLatest.marketId, market.id)),
    db.select({ itemKey: t.vendorPrices.itemKey, price: t.vendorPrices.priceCopper }).from(t.vendorPrices),
    db.select({ itemKey: t.items.itemKey, name: t.items.name, quality: t.items.quality }).from(t.items),
    loadHoldings(db),
    db.select().from(t.recipes),
    db.select().from(t.recipeReagents).orderBy(asc(t.recipeReagents.spellId), asc(t.recipeReagents.itemId)),
    db
      .select({ spellId: t.characterRecipes.spellId, id: t.characters.id, name: t.characters.name, class: t.characters.class })
      .from(t.characterRecipes)
      .innerJoin(t.characters, eq(t.characters.id, t.characterRecipes.characterId))
      .orderBy(asc(t.characters.name)),
    db
      .select({ id: t.marketImports.id, receivedAt: t.marketImports.receivedAt, fileModifiedAt: t.marketImports.fileModifiedAt, lastDay: t.marketImports.lastDay })
      .from(t.marketImports)
      .where(eq(t.marketImports.marketId, market.id))
      // Le relevé le plus frais, pas le dernier reçu : un PC peut envoyer après un autre un fichier plus ancien.
      .orderBy(sql`${t.marketImports.lastDay} desc nulls last`, desc(t.marketImports.fileModifiedAt), desc(t.marketImports.id))
      .limit(1),
    db.select({ id: t.syncRuns.id }).from(t.syncRuns).orderBy(desc(t.syncRuns.id)).limit(1),
    db.selectDistinct({ skillLine: t.characterProfessions.skillLine, name: t.characterProfessions.name }).from(t.characterProfessions),
    db.select({ id: t.marketImports.id }).from(t.marketImports).where(eq(t.marketImports.marketId, market.id)).orderBy(desc(t.marketImports.id)).limit(1),
  ]);

  const daysByItem = new Map<string, DayObservation[]>();
  for (const row of dayRows) {
    const list = daysByItem.get(row.itemKey) ?? [];
    list.push({ day: row.day, low: row.low, high: row.high, available: row.available });
    daysByItem.set(row.itemKey, list);
  }
  for (const list of daysByItem.values()) list.sort((a, b) => (a.day < b.day ? -1 : 1));
  const latestByItem = new Map(latestRows.map((row) => [row.itemKey, { minCopper: row.minCopper, day: row.day }]));
  const stats = new Map<string, ItemStats>();
  for (const itemKey of new Set([...daysByItem.keys(), ...latestByItem.keys()])) {
    stats.set(itemKey, computeItemStats(itemKey, daysByItem.get(itemKey) ?? [], latestByItem.get(itemKey) ?? null, today, historyFrom));
  }

  const vendor = new Map(vendorRows.map((row) => [row.itemKey, row.price]));
  const names = new Map(itemRows.map((row) => [row.itemKey, { name: row.name, quality: row.quality }]));
  const stock = new Map([...holdings].map(([itemKey, list]) => [itemKey, list.reduce((total, holding) => total + holding.quantity, 0)]));

  const reagentsBySpell = new Map<number, { itemId: number; quantity: number }[]>();
  for (const row of reagentRows) {
    const list = reagentsBySpell.get(row.spellId) ?? [];
    list.push({ itemId: row.itemId, quantity: row.quantity });
    reagentsBySpell.set(row.spellId, list);
  }
  const knownBySpell = new Map<number, KnownRecipe["characters"]>();
  for (const row of knownRows) {
    const list = knownBySpell.get(row.spellId) ?? [];
    list.push({ id: row.id, name: row.name, class: row.class });
    knownBySpell.set(row.spellId, list);
  }
  // Seules les recettes connues d'au moins un personnage intéressent le joueur.
  const recipes: KnownRecipe[] = recipeRows
    .filter((row) => knownBySpell.has(row.spellId) && reagentsBySpell.has(row.spellId))
    .map((row) => ({
      spellId: row.spellId,
      skillLine: row.skillLine,
      outputItemId: row.outputItemId,
      outputQuantity: row.outputQuantity,
      cooldown: row.cooldown,
      reagents: reagentsBySpell.get(row.spellId)!,
      characters: knownBySpell.get(row.spellId)!,
    }));

  // Objets jamais possédés : le nom vient de la table du jeu (Paramètres → Noms des objets).
  const shownKeys = [
    ...stats.keys(),
    ...holdings.keys(),
    ...recipes.flatMap((recipe) => [String(recipe.outputItemId), ...recipe.reagents.map((reagent) => String(reagent.itemId))]),
  ];
  await fillCatalogNames(db, names, shownKeys);
  await attachItemIcons(db, names, shownKeys);

  const craftOptions = { ...DEFAULT_CRAFT_OPTIONS, auctionCut };
  const crafts = recipes.map((recipe) =>
    evaluateRecipe(recipe, (k) => stats.get(k), (k) => vendor.get(k), (k) => stock.get(k) ?? 0, craftOptions),
  );

  // Ressources à farmer : les composants des recettes connues que nul marchand ne vend.
  const farmable = new Set(recipes.flatMap((r) => r.reagents.map((x) => String(x.itemId))).filter((k) => !vendor.has(k)));
  const farmSignals = [...farmable]
    .map((k) => stats.get(k))
    .flatMap((s) => (s ? [farmSignal(s)].filter((x) => x !== null) : []))
    .sort((a, b) => b.score - a.score || b.unitValue - a.unitValue);

  return {
    market,
    markets,
    today,
    historyFrom,
    auctionCut,
    stats,
    days: daysByItem,
    names,
    vendor,
    stock,
    holdings,
    recipes,
    crafts,
    professions: new Map(professionRows.map((row) => [row.skillLine, row.name])),
    farmSignals,
    lastImport: lastImportRows[0] ?? null,
    newestImportId: newestImport[0]?.id ?? null,
    lastSyncRunId: lastRun[0]?.id ?? null,
  };
}

export type MarketValues = {
  /** Marché dont viennent les valeurs : le plus récemment relevé, comme sur les pages de l'économie. */
  market: { id: number; label: string } | null;
  /** Valeur de marché d'une unité, en pièces de cuivre ; les objets sans valeur sont absents. */
  values: Map<string, number>;
};

/**
 * Valeur de marché de quelques objets (médiane des plus bas journaliers, voir computeItemStats) :
 * la même que la colonne « Valeur détenue » de la page Marché, commission non déduite.
 */
export async function loadMarketValues(db: Database, itemKeys: readonly string[], now: Date): Promise<MarketValues> {
  const market = (await listMarkets(db)).find((m) => m.lastDay !== null);
  const keys = [...new Set(itemKeys)];
  if (!market || keys.length === 0) return { market: market ? { id: market.id, label: market.label } : null, values: new Map() };

  const { historyFrom, today, from } = statsWindow(await readSettings(db), now);
  const [dayRows, latestRows] = await Promise.all([
    db
      .select({ itemKey: t.marketItemDays.itemKey, day: t.marketItemDays.day, low: t.marketItemDays.lowCopper, high: t.marketItemDays.highCopper, available: t.marketItemDays.available })
      .from(t.marketItemDays)
      .where(and(eq(t.marketItemDays.marketId, market.id), gte(t.marketItemDays.day, from), inArray(t.marketItemDays.itemKey, keys))),
    db
      .select({ itemKey: t.marketItemLatest.itemKey, minCopper: t.marketItemLatest.minCopper, day: t.marketItemLatest.day })
      .from(t.marketItemLatest)
      .where(and(eq(t.marketItemLatest.marketId, market.id), inArray(t.marketItemLatest.itemKey, keys))),
  ]);
  const days = new Map<string, DayObservation[]>();
  for (const { itemKey, ...day } of dayRows) days.set(itemKey, [...(days.get(itemKey) ?? []), day]);
  const latest = new Map(latestRows.map((row) => [row.itemKey, { minCopper: row.minCopper, day: row.day }]));

  const values = new Map<string, number>();
  for (const itemKey of new Set([...days.keys(), ...latest.keys()])) {
    const value = computeItemStats(itemKey, days.get(itemKey) ?? [], latest.get(itemKey) ?? null, today, historyFrom).marketValue;
    if (value !== null) values.set(itemKey, Math.round(value));
  }
  return { market: { id: market.id, label: market.label }, values };
}

/** Historique complet d'un objet sur un marché, du plus ancien au plus récent. */
export async function loadItemHistory(db: Database, marketId: number, itemKey: string): Promise<DayObservation[]> {
  const rows = await db
    .select({ day: t.marketItemDays.day, low: t.marketItemDays.lowCopper, high: t.marketItemDays.highCopper, available: t.marketItemDays.available })
    .from(t.marketItemDays)
    .where(and(eq(t.marketItemDays.marketId, marketId), eq(t.marketItemDays.itemKey, itemKey)))
    .orderBy(asc(t.marketItemDays.day));
  return rows;
}

/** Historique complet de plusieurs objets (produit et composants d'une recette), par objet. */
export async function loadItemsHistory(db: Database, marketId: number, itemKeys: readonly string[]): Promise<Map<string, DayObservation[]>> {
  const result = new Map<string, DayObservation[]>(itemKeys.map((key) => [key, []]));
  if (itemKeys.length === 0) return result;
  const rows = await db
    .select({ itemKey: t.marketItemDays.itemKey, day: t.marketItemDays.day, low: t.marketItemDays.lowCopper, high: t.marketItemDays.highCopper, available: t.marketItemDays.available })
    .from(t.marketItemDays)
    .where(and(eq(t.marketItemDays.marketId, marketId), inArray(t.marketItemDays.itemKey, [...itemKeys])))
    .orderBy(asc(t.marketItemDays.day));
  for (const { itemKey, ...day } of rows) result.get(itemKey)?.push(day);
  return result;
}

/** Nombre d'objets relevés par jour : un jour très en dessous des autres est un relevé partiel. */
export async function loadCoverage(db: Database, marketId: number, from: string | null): Promise<{ day: string; items: number }[]> {
  const rows = await db
    .select({ day: t.marketItemDays.day, items: sql<number>`count(*)::int` })
    .from(t.marketItemDays)
    .where(from ? and(eq(t.marketItemDays.marketId, marketId), gte(t.marketItemDays.day, from)) : eq(t.marketItemDays.marketId, marketId))
    .groupBy(t.marketItemDays.day)
    .orderBy(asc(t.marketItemDays.day));
  return rows;
}

/** Valeur réalisable d'une unité : valeur de marché, commission déduite ; null sans prix. */
export function realizableValueOf(context: EconomyContext | null): (itemKey: string) => number | null {
  return (itemKey) => {
    const value = context?.stats.get(itemKey)?.marketValue;
    return value === null || value === undefined ? null : value * (1 - context!.auctionCut);
  };
}
