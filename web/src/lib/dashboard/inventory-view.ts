import { formatRelative } from "@/lib/wow/format";
import { canUse, CLASSIC_CLASSES, type GearSpec, isGearSlot, isGearType, matchesGearSlot, matchesGearType } from "@/lib/wow/gear";
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

/** En deçà, une échéance est proche : signalée sur la case, sur l'accueil, et retenue par le filtre « Bientôt échus ». */
export const SOON_DAYS = 3;
const SOON_MS = SOON_DAYS * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Échéance proche (dans les SOON_DAYS jours) ou déjà passée ; faux sans échéance. */
export function isSoon(expiresAt: Date | string | null, now: Date): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= now.getTime() + SOON_MS;
}

export type ExpiryFlag = { text: string; tone: "expired" | "soon" };

/** Mention au coin d'une case : « échu », ou le temps restant quand l'échéance est proche (« 5 h », « 2 j »). */
export function expiryFlag(expiresAt: Date | string | null, now: Date): ExpiryFlag | null {
  if (expiresAt === null) return null;
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return { text: "échu", tone: "expired" };
  if (left > SOON_MS) return null;
  if (left < HOUR_MS) return { text: "< 1 h", tone: "soon" };
  if (left < 48 * HOUR_MS) return { text: `${Math.floor(left / HOUR_MS)} h`, tone: "soon" };
  return { text: `${Math.floor(left / (24 * HOUR_MS))} j`, tone: "soon" };
}

export const VIEWS = ["items", "characters"] as const;
export type InventoryView = (typeof VIEWS)[number];

/** Un personnage choisi s'affiche sac par sac, comme en jeu ; sinon les objets de tous sont regroupés. */
export const defaultView = (character: string): InventoryView => (character === "" ? "items" : "characters");

export const SORTS = ["total", "value", "name", "quality", "level"] as const;
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
  /** Seulement les courriers et ventes dont l'échéance est proche (SOON_DAYS). */
  soon: boolean;
  /** Équipement : type d'armure ou d'arme (valeur de gear.ts), ou vide. */
  gearType: string;
  /** Équipement : emplacement (valeur de gear.ts), ou vide. */
  gearSlot: string;
  /** Niveau requis minimal et maximal (« 20 », « 30 »), ou vide. */
  minLevel: string;
  maxLevel: string;
  /** Équipement portable par une classe (« MAGE ») ou par un personnage (son identifiant), ou vide. */
  wearer: string;
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
  soon: false,
  gearType: "",
  gearSlot: "",
  minLevel: "",
  maxLevel: "",
  wearer: "",
  view: "items",
  sort: "total",
};

const MAX_TEXT = 80;
const PARAMS = {
  query: "q",
  account: "compte",
  character: "perso",
  places: "lieux",
  minQuality: "qualite",
  expired: "echus",
  soon: "bientot",
  gearType: "type",
  gearSlot: "emplacement",
  minLevel: "nmin",
  maxLevel: "nmax",
  wearer: "pour",
  view: "vue",
  sort: "tri",
} as const;
const OWNED = Object.values(PARAMS);
const VIEW_VALUES: Record<InventoryView, string> = { items: "objets", characters: "personnages" };
const SORT_VALUES: Record<InventorySort, string> = { total: "quantite", value: "valeur", name: "nom", quality: "qualite", level: "niveau" };
const PLACE_VALUES: Record<InventoryPlace, string> = { bags: "sacs", bank: "banque", mail: "courrier", auctions: "encheres", guild: "guilde" };

const isId = (value: string | null): value is string => value !== null && /^\d{1,9}$/.test(value);
const isLevel = (value: string | null): value is string => value !== null && /^\d{1,3}$/.test(value) && Number(value) >= 1;

/** Classes dans l'adresse, en français : « pour=chasseur ». */
export const CLASS_SLUGS: Readonly<Record<string, string>> = {
  WARRIOR: "guerrier",
  PALADIN: "paladin",
  HUNTER: "chasseur",
  ROGUE: "voleur",
  PRIEST: "pretre",
  SHAMAN: "chaman",
  MAGE: "mage",
  WARLOCK: "demoniste",
  DRUID: "druide",
};

function readWearer(value: string | null): string {
  if (isId(value)) return value;
  return CLASSIC_CLASSES.find((token) => CLASS_SLUGS[token] === value) ?? "";
}

/** État lu dans les paramètres de l'adresse ; une valeur illisible garde sa valeur par défaut. */
export function readInventoryState(params: { get(name: string): string | null }): InventoryState {
  const account = params.get(PARAMS.account);
  const character = params.get(PARAMS.character);
  const quality = params.get(PARAMS.minQuality);
  const placesValue = params.get(PARAMS.places);
  const gearType = params.get(PARAMS.gearType);
  const gearSlot = params.get(PARAMS.gearSlot);
  const minLevel = params.get(PARAMS.minLevel);
  const maxLevel = params.get(PARAMS.maxLevel);
  const places = placesValue === null ? [...PLACES] : PLACES.filter((place) => placesValue.split(",").includes(PLACE_VALUES[place]));
  return {
    query: (params.get(PARAMS.query) ?? "").slice(0, MAX_TEXT),
    account: isId(account) ? account : "",
    character: isId(character) ? character : "",
    places: places.length === 0 ? [...PLACES] : places,
    minQuality: quality !== null && /^[0-7]$/.test(quality) ? quality : "",
    expired: params.get(PARAMS.expired) === "1",
    soon: params.get(PARAMS.soon) === "1",
    gearType: gearType !== null && isGearType(gearType) ? gearType : "",
    gearSlot: gearSlot !== null && isGearSlot(gearSlot) ? gearSlot : "",
    minLevel: isLevel(minLevel) ? String(Number(minLevel)) : "",
    maxLevel: isLevel(maxLevel) ? String(Number(maxLevel)) : "",
    wearer: readWearer(params.get(PARAMS.wearer)),
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
  if (state.soon) params.set(PARAMS.soon, "1");
  if (state.gearType !== "") params.set(PARAMS.gearType, state.gearType);
  if (state.gearSlot !== "") params.set(PARAMS.gearSlot, state.gearSlot);
  if (state.minLevel !== "") params.set(PARAMS.minLevel, state.minLevel);
  if (state.maxLevel !== "") params.set(PARAMS.maxLevel, state.maxLevel);
  if (state.wearer !== "") params.set(PARAMS.wearer, CLASS_SLUGS[state.wearer] ?? state.wearer);
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

/** Un filtre d'équipement est actif : seules les armures et les armes connues restent. */
export const gearFiltered = (state: InventoryState) =>
  state.gearType !== "" || state.gearSlot !== "" || state.minLevel !== "" || state.maxLevel !== "" || state.wearer !== "";

/**
 * L'équipement passe-t-il les filtres de type, d'emplacement, de niveau requis et de porteur ? Un
 * niveau requis inconnu ne passe pas un filtre de niveau ; un objet sans niveau requis compte
 * pour le niveau 1. Un personnage peut porter ce que sa classe sait porter à son niveau.
 */
export function gearMatches(spec: GearSpec | undefined, state: InventoryState, characters: InventoryData["characters"]): boolean {
  if (!gearFiltered(state)) return true;
  if (!spec) return false;
  if (state.gearType !== "" && !matchesGearType(spec, state.gearType)) return false;
  if (state.gearSlot !== "" && !matchesGearSlot(spec, state.gearSlot)) return false;
  if (state.minLevel !== "" || state.maxLevel !== "") {
    if (spec.requiredLevel === null) return false;
    const level = Math.max(spec.requiredLevel, 1);
    if (state.minLevel !== "" && level < Number(state.minLevel)) return false;
    if (state.maxLevel !== "" && level > Number(state.maxLevel)) return false;
  }
  if (state.wearer === "") return true;
  if (!isId(state.wearer)) return canUse(spec, state.wearer);
  const wearer = characters.find((character) => String(character.id) === state.wearer);
  return wearer?.class != null && canUse(spec, wearer.class, wearer.level ?? 1);
}

/** Toutes les lignes qui passent les filtres. */
export function selectHoldings(data: InventoryData, state: InventoryState, now: Date): Holding[] {
  const needle = fold(state.query.trim());
  const minQuality = state.minQuality === "" ? null : Number(state.minQuality);
  const accountId = state.account === "" ? null : Number(state.account);
  const characterId = state.character === "" ? null : Number(state.character);
  const accountOf = new Map(data.characters.map((character) => [character.id, character.account.id]));
  // Calculé une fois par objet : un même objet revient chez plusieurs détenteurs.
  const gear = new Map<string, boolean>();
  const gearOk = (itemKey: string) => {
    let ok = gear.get(itemKey);
    if (ok === undefined) gear.set(itemKey, (ok = gearMatches(data.items[itemKey]?.gear, state, data.characters)));
    return ok;
  };

  const keep = (holding: Holding) => {
    if (!state.places.includes(holdingPlace(holding))) return false;
    if (!state.expired && isExpired(holding, now)) return false;
    if (state.soon && (holding.kind !== "character" || !isSoon(holding.expiresAt, now))) return false;
    const info = data.items[holding.itemKey];
    if (minQuality !== null && (info?.quality ?? -1) < minQuality) return false;
    if (!gearOk(holding.itemKey)) return false;
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

/** Prix d'une unité de chaque objet, en pièces de cuivre (InventoryData.prices). */
export type Prices = Readonly<Record<string, number>>;

/**
 * unit : valeur de marché d'une unité ; value : celle de tous les exemplaires. Null sans prix connu.
 */
export type ItemRow = { itemKey: string; name: string | null; quality: number | null; total: number; unit: number | null; value: number | null; holdings: Holding[] };

/**
 * Valeur de marché de lignes d'inventaire, et nombre d'exemplaires sans prix connu. Un courrier ou
 * une vente échus ne comptent pas : l'objet a été renvoyé, supprimé ou vendu.
 */
export function holdingsValue(
  holdings: readonly { itemKey: string; quantity: number; expiresAt?: string | null }[],
  prices: Prices,
  now: Date,
): { value: number; unpriced: number } {
  let value = 0;
  let unpriced = 0;
  for (const holding of holdings) {
    if (holding.expiresAt && new Date(holding.expiresAt).getTime() <= now.getTime()) continue;
    const unit = prices[holding.itemKey];
    if (unit === undefined) unpriced += holding.quantity;
    else value += unit * holding.quantity;
  }
  return { value, unpriced };
}

/**
 * Mention au coin de la case d'un objet tous détenteurs confondus : « échu » quand tous ses
 * courriers et ventes le sont, sinon l'échéance proche la plus courte.
 */
export function rowFlag(holdings: readonly Holding[], now: Date): ExpiryFlag | null {
  let expired = 0;
  let soonest: { flag: ExpiryFlag; at: number } | null = null;
  for (const holding of holdings) {
    const flag = holding.kind === "character" ? expiryFlag(holding.expiresAt, now) : null;
    if (flag?.tone === "expired") expired += 1;
    if (flag?.tone !== "soon" || holding.kind !== "character" || holding.expiresAt === null) continue;
    const at = new Date(holding.expiresAt).getTime();
    if (soonest === null || at < soonest.at) soonest = { flag, at };
  }
  if (holdings.length > 0 && expired === holdings.length) return { text: "échu", tone: "expired" };
  return soonest?.flag ?? null;
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
/** Niveau requis pour le tri : 0 sans exigence, −1 pour un objet qui n'est pas de l'équipement. */
const requiredLevel = (info: InventoryItemInfo | undefined) => (info?.gear ? (info.gear.requiredLevel ?? 0) : -1);

/** Un objet par ligne, quantités additionnées sur tous les détenteurs, du plus gros détenteur au plus petit. */
export function groupByItem(holdings: Holding[], items: InventoryData["items"], sort: InventorySort, prices: Prices = {}): ItemRow[] {
  const rows = new Map<string, ItemRow>();
  for (const holding of holdings) {
    let row = rows.get(holding.itemKey);
    if (!row) {
      const info = items[holding.itemKey];
      const unit = prices[holding.itemKey] ?? null;
      row = { itemKey: holding.itemKey, name: info?.name ?? null, quality: info?.quality ?? null, total: 0, unit, value: null, holdings: [] };
      rows.set(holding.itemKey, row);
    }
    row.total += holding.quantity;
    row.holdings.push(holding);
  }
  for (const row of rows.values()) {
    row.holdings.sort((a, b) => b.quantity - a.quantity);
    row.value = row.unit === null ? null : row.unit * row.total;
  }

  const byName = (a: ItemRow, b: ItemRow) => collator.compare(a.name ?? `~${a.itemKey}`, b.name ?? `~${b.itemKey}`);
  const compare: Record<InventorySort, (a: ItemRow, b: ItemRow) => number> = {
    total: (a, b) => b.total - a.total || byName(a, b),
    // Sans prix connu : après tous les objets valorisés.
    value: (a, b) => (b.value ?? -1) - (a.value ?? -1) || byName(a, b),
    name: byName,
    quality: (a, b) => (b.quality ?? -1) - (a.quality ?? -1) || byName(a, b),
    // Niveau requis, du plus haut au plus bas ; les objets qui ne sont pas de l'équipement ensuite.
    level: (a, b) => requiredLevel(items[b.itemKey]) - requiredLevel(items[a.itemKey]) || byName(a, b),
  };
  return [...rows.values()].sort(compare[sort]);
}

/** Lignes d'un même endroit rangées comme la grille des objets : quantité, valeur, nom ou qualité. */
export function sortHoldings(holdings: readonly Holding[], items: InventoryData["items"], sort: InventorySort, prices: Prices = {}): Holding[] {
  const name = (holding: Holding) => items[holding.itemKey]?.name ?? `~${holding.itemKey}`;
  const byName = (a: Holding, b: Holding) => collator.compare(name(a), name(b));
  const value = (holding: Holding) => (prices[holding.itemKey] === undefined ? -1 : prices[holding.itemKey] * holding.quantity);
  const compare: Record<InventorySort, (a: Holding, b: Holding) => number> = {
    total: (a, b) => b.quantity - a.quantity || byName(a, b),
    value: (a, b) => value(b) - value(a) || byName(a, b),
    name: byName,
    quality: (a, b) => (items[b.itemKey]?.quality ?? -1) - (items[a.itemKey]?.quality ?? -1) || byName(a, b),
    level: (a, b) => requiredLevel(items[b.itemKey]) - requiredLevel(items[a.itemKey]) || byName(a, b),
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
