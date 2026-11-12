import { formatRelative } from "@/lib/wow/format";
import type { InventoryData, InventoryItemInfo, InventoryLocation } from "./inventory";

// Page Inventaires : filtres, regroupement par objet ou par personnage, et état porté par l'adresse
// (il survit à l'ouverture d'une fiche puis au retour, et se partage par lien). Fonctions pures,
// appelées par le composant client à chaque frappe.

export type InventoryPlace = InventoryLocation | "guild";

export const PLACES: readonly InventoryPlace[] = ["bags", "bank", "mail", "auctions", "guild"];

export const PLACE_LABELS: Record<InventoryPlace, string> = {
  bags: "Sacs",
  bank: "Banque",
  mail: "Courrier",
  auctions: "Enchères",
  guild: "Banque de guilde",
};

/** Échéance d'un courrier ou d'une vente : « expire dans 3 jours », ou « expiré » une fois passée. */
export function holdingNote(expiresAt: Date | string | null, now: Date): { text: string; warn: boolean } | undefined {
  if (expiresAt === null) return undefined;
  const at = new Date(expiresAt);
  return at.getTime() <= now.getTime() ? { text: "expiré", warn: true } : { text: `expire ${formatRelative(at, now)}`, warn: false };
}

export const VIEWS = ["items", "characters"] as const;
export type InventoryView = (typeof VIEWS)[number];

/** Un personnage choisi s'affiche sac par sac, comme en jeu ; sinon les objets de tous sont regroupés. */
export const defaultView = (character: string): InventoryView => (character === "" ? "items" : "characters");

export const SORTS = ["total", "name", "quality"] as const;
export type InventorySort = (typeof SORTS)[number];

export type InventoryState = {
  query: string;
  /** Identifiant du compte, ou vide pour tous. */
  account: string;
  /** Identifiant du personnage, ou vide pour tous ; les banques de guilde sont alors écartées. */
  character: string;
  places: InventoryPlace[];
  /** Qualité minimale (0 médiocre … 7 héritage), ou vide pour toutes. */
  minQuality: string;
  /** Courriers et ventes dont l'échéance est passée au moment du relevé suivant. */
  expired: boolean;
  view: InventoryView;
  sort: InventorySort;
};

export const DEFAULT_STATE: InventoryState = {
  query: "",
  account: "",
  character: "",
  places: [...PLACES],
  minQuality: "",
  expired: false,
  view: "items",
  sort: "total",
};

const MAX_TEXT = 80;
const PARAMS = { query: "q", account: "compte", character: "perso", places: "lieux", minQuality: "qualite", expired: "echus", view: "vue", sort: "tri" } as const;
const OWNED = Object.values(PARAMS);
const VIEW_VALUES: Record<InventoryView, string> = { items: "objets", characters: "personnages" };
const SORT_VALUES: Record<InventorySort, string> = { total: "quantite", name: "nom", quality: "qualite" };
const PLACE_VALUES: Record<InventoryPlace, string> = { bags: "sacs", bank: "banque", mail: "courrier", auctions: "encheres", guild: "guilde" };

const isId = (value: string | null): value is string => value !== null && /^\d{1,9}$/.test(value);

/** État lu dans les paramètres de l'adresse ; une valeur illisible garde sa valeur par défaut. */
export function readInventoryState(params: { get(name: string): string | null }): InventoryState {
  const account = params.get(PARAMS.account);
  const character = params.get(PARAMS.character);
  const quality = params.get(PARAMS.minQuality);
  const placesValue = params.get(PARAMS.places);
  const places = placesValue === null ? [...PLACES] : PLACES.filter((place) => placesValue.split(",").includes(PLACE_VALUES[place]));
  return {
    query: (params.get(PARAMS.query) ?? "").slice(0, MAX_TEXT),
    account: isId(account) ? account : "",
    character: isId(character) ? character : "",
    places: places.length === 0 ? [...PLACES] : places,
    minQuality: quality !== null && /^[0-7]$/.test(quality) ? quality : "",
    expired: params.get(PARAMS.expired) === "1",
    view: VIEWS.find((view) => VIEW_VALUES[view] === params.get(PARAMS.view)) ?? defaultView(isId(character) ? character : ""),
    sort: SORTS.find((sort) => SORT_VALUES[sort] === params.get(PARAMS.sort)) ?? DEFAULT_STATE.sort,
  };
}

/** Chaîne de requête (« ?… », ou vide) qui porte l'état ; les autres paramètres restent, les valeurs par défaut sont omises. */
export function writeInventoryState(state: InventoryState, current = ""): string {
  const params = new URLSearchParams(current);
  for (const name of OWNED) params.delete(name);

  if (state.query.trim() !== "") params.set(PARAMS.query, state.query);
  if (state.account !== "") params.set(PARAMS.account, state.account);
  if (state.character !== "") params.set(PARAMS.character, state.character);
  if (state.places.length > 0 && state.places.length < PLACES.length) {
    params.set(PARAMS.places, PLACES.filter((place) => state.places.includes(place)).map((place) => PLACE_VALUES[place]).join(","));
  }
  if (state.minQuality !== "") params.set(PARAMS.minQuality, state.minQuality);
  if (state.expired) params.set(PARAMS.expired, "1");
  if (state.view !== defaultView(state.character)) params.set(PARAMS.view, VIEW_VALUES[state.view]);
  if (state.sort !== DEFAULT_STATE.sort) params.set(PARAMS.sort, SORT_VALUES[state.sort]);

  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** Quantité inscrite dans une case, comme en jeu : au-delà de 9 999, en milliers (« 12,3k », « 245k »). */
export function slotCount(quantity: number): string {
  if (quantity < 10_000) return String(quantity);
  const thousands = quantity / 1000;
  const shown = thousands < 100 ? Math.floor(thousands * 10) / 10 : Math.floor(thousands);
  return `${String(shown).replace(".", ",")}k`;
}

/** Minuscules sans accents : « epee » trouve « Épée ». */
export const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Une ligne de l'inventaire : un objet chez un personnage à un endroit, ou dans un onglet de banque de guilde. */
export type Holding =
  | { kind: "character"; itemKey: string; characterId: number; location: InventoryLocation; quantity: number; expiresAt: string | null }
  | { kind: "guild"; itemKey: string; guildId: number; tab: number; quantity: number };

export const holdingPlace = (holding: Holding): InventoryPlace => (holding.kind === "guild" ? "guild" : holding.location);

const isExpired = (holding: Holding, now: Date) =>
  holding.kind === "character" && holding.expiresAt !== null && new Date(holding.expiresAt).getTime() <= now.getTime();

/** Le nom de l'objet contient le texte cherché ; un nombre désigne l'identifiant, toutes variantes comprises. */
function matchesQuery(itemKey: string, info: InventoryItemInfo | undefined, needle: string): boolean {
  if (needle === "") return true;
  if (/^\d+$/.test(needle)) return itemKey === needle || itemKey.startsWith(`${needle}:`);
  return fold(info?.name ?? "").includes(needle);
}

/** Toutes les lignes qui passent les filtres. */
export function selectHoldings(data: InventoryData, state: InventoryState, now: Date): Holding[] {
  const needle = fold(state.query.trim());
  const minQuality = state.minQuality === "" ? null : Number(state.minQuality);
  const accountId = state.account === "" ? null : Number(state.account);
  const characterId = state.character === "" ? null : Number(state.character);
  const accountOf = new Map(data.characters.map((character) => [character.id, character.account.id]));

  const keep = (holding: Holding) => {
    if (!state.places.includes(holdingPlace(holding))) return false;
    if (!state.expired && isExpired(holding, now)) return false;
    const info = data.items[holding.itemKey];
    if (minQuality !== null && (info?.quality ?? -1) < minQuality) return false;
    return matchesQuery(holding.itemKey, info, needle);
  };

  const holdings: Holding[] = [];
  for (const entry of data.entries) {
    if (characterId !== null && entry.characterId !== characterId) continue;
    if (accountId !== null && accountOf.get(entry.characterId) !== accountId) continue;
    const holding: Holding = { kind: "character", ...entry };
    if (keep(holding)) holdings.push(holding);
  }
  if (characterId === null) {
    for (const guild of data.guilds) {
      if (accountId !== null && guild.accountId !== accountId) continue;
      for (const tab of guild.tabs) {
        for (const item of tab.items) {
          const holding: Holding = { kind: "guild", itemKey: item.itemKey, guildId: guild.id, tab: tab.index, quantity: item.quantity };
          if (keep(holding)) holdings.push(holding);
        }
      }
    }
  }
  return holdings;
}

export type ItemRow = { itemKey: string; name: string | null; quality: number | null; total: number; holdings: Holding[] };

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Un objet par ligne, quantités additionnées sur tous les détenteurs, du plus gros détenteur au plus petit. */
export function groupByItem(holdings: Holding[], items: InventoryData["items"], sort: InventorySort): ItemRow[] {
  const rows = new Map<string, ItemRow>();
  for (const holding of holdings) {
    let row = rows.get(holding.itemKey);
    if (!row) {
      const info = items[holding.itemKey];
      row = { itemKey: holding.itemKey, name: info?.name ?? null, quality: info?.quality ?? null, total: 0, holdings: [] };
      rows.set(holding.itemKey, row);
    }
    row.total += holding.quantity;
    row.holdings.push(holding);
  }
  for (const row of rows.values()) row.holdings.sort((a, b) => b.quantity - a.quantity);

  const byName = (a: ItemRow, b: ItemRow) => collator.compare(a.name ?? `~${a.itemKey}`, b.name ?? `~${b.itemKey}`);
  const compare: Record<InventorySort, (a: ItemRow, b: ItemRow) => number> = {
    total: (a, b) => b.total - a.total || byName(a, b),
    name: byName,
    quality: (a, b) => (b.quality ?? -1) - (a.quality ?? -1) || byName(a, b),
  };
  return [...rows.values()].sort(compare[sort]);
}

/** Lignes d'un même endroit rangées comme la grille des objets : quantité, nom ou qualité. */
export function sortHoldings(holdings: readonly Holding[], items: InventoryData["items"], sort: InventorySort): Holding[] {
  const name = (holding: Holding) => items[holding.itemKey]?.name ?? `~${holding.itemKey}`;
  const byName = (a: Holding, b: Holding) => collator.compare(name(a), name(b));
  const compare: Record<InventorySort, (a: Holding, b: Holding) => number> = {
    total: (a, b) => b.quantity - a.quantity || byName(a, b),
    name: byName,
    quality: (a, b) => (items[b.itemKey]?.quality ?? -1) - (items[a.itemKey]?.quality ?? -1) || byName(a, b),
  };
  return [...holdings].sort(compare[sort]);
}

/** Objets d'un même endroit, du plus nombreux au moins nombreux. */
export type PlaceGroup = { place: InventoryPlace; tab?: number; holdings: Holding[] };

/** Lignes d'un personnage, rangées par endroit dans l'ordre des sacs aux enchères. */
export function groupByCharacter(holdings: Holding[]): Map<number, PlaceGroup[]> {
  const result = new Map<number, PlaceGroup[]>();
  for (const holding of holdings) {
    if (holding.kind !== "character") continue;
    const groups = result.get(holding.characterId) ?? [];
    let group = groups.find((candidate) => candidate.place === holding.location);
    if (!group) {
      group = { place: holding.location, holdings: [] };
      groups.push(group);
    }
    group.holdings.push(holding);
    result.set(holding.characterId, groups);
  }
  for (const groups of result.values()) {
    groups.sort((a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place));
    for (const group of groups) group.holdings.sort((a, b) => b.quantity - a.quantity);
  }
  return result;
}

/** Lignes d'une banque de guilde, rangées par onglet. */
export function groupByGuild(holdings: Holding[]): Map<number, PlaceGroup[]> {
  const result = new Map<number, PlaceGroup[]>();
  for (const holding of holdings) {
    if (holding.kind !== "guild") continue;
    const groups = result.get(holding.guildId) ?? [];
    let group = groups.find((candidate) => candidate.tab === holding.tab);
    if (!group) {
      group = { place: "guild", tab: holding.tab, holdings: [] };
      groups.push(group);
    }
    group.holdings.push(holding);
    result.set(holding.guildId, groups);
  }
  for (const groups of result.values()) {
    groups.sort((a, b) => (a.tab ?? 0) - (b.tab ?? 0));
    for (const group of groups) group.holdings.sort((a, b) => b.quantity - a.quantity);
  }
  return result;
}
