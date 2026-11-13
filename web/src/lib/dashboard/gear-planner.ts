import { ARMOR, boundToHolder, canUse, CLASSIC_CLASSES, type GearSpec, type ItemSpec, PROFICIENCY_LEVEL, WEAPON } from "@/lib/wow/gear";
import type { InventoryCharacter, InventoryData } from "./inventory";
import { CLASS_SLUGS, fold, type Holding, holdingPlace, type InventoryPlace, PLACES, readWearer } from "./inventory-view";

// Page Équipement : pour une classe ou un personnage, et un niveau, le meilleur équipement que les
// personnages ont en réserve, emplacement par emplacement, comme la fiche de personnage du jeu.
// Fonctions pures, appelées par le composant client à chaque changement.

/** Plus haut niveau de WoW Classic. */
export const MAX_LEVEL = 60;

/** Objet porté par un personnage (emplacement d'équipement du jeu, 1 à 19), tel que l'addon le relève. */
export type EquippedItem = {
  slot: number;
  itemId: number | null;
  name: string | null;
  quality: number | null;
  itemLevel: number | null;
  icon: string | null;
  /** Classe et sous-classe tirées de item_specs, pour le type d'armure ; null si l'objet n'y est pas. */
  spec: Pick<ItemSpec, "itemClass" | "subclass"> | null;
};

/** Données de la page : l'équipement en réserve (inventaires réduits aux armures et aux armes) et ce que chacun porte. */
export type GearPlannerData = Pick<InventoryData, "characters" | "entries" | "guilds" | "items"> & {
  /** Objets portés, par identifiant de personnage. */
  equipment: Record<string, EquippedItem[]>;
};

/**
 * Emplacement de la fiche : les InventoryType du jeu qu'il accepte, les emplacements d'équipement
 * (1 à 19) qu'il remplace, le nombre d'objets qu'il porte (deux anneaux, deux bijoux) et sa colonne.
 */
export type PlannerSlot = { id: string; label: string; types: readonly number[]; equipped: readonly number[]; count: 1 | 2; column: "left" | "right" | "weapons" };

/** Dans l'ordre de la fiche du jeu ; chemise et tabard, sans effet, sont laissés de côté. */
export const PLANNER_SLOTS: readonly PlannerSlot[] = [
  { id: "tete", label: "Tête", types: [1], equipped: [1], count: 1, column: "left" },
  { id: "cou", label: "Cou", types: [2], equipped: [2], count: 1, column: "left" },
  { id: "epaules", label: "Épaules", types: [3], equipped: [3], count: 1, column: "left" },
  { id: "dos", label: "Dos", types: [16], equipped: [15], count: 1, column: "left" },
  { id: "torse", label: "Torse", types: [5, 20], equipped: [5], count: 1, column: "left" },
  { id: "poignets", label: "Poignets", types: [9], equipped: [9], count: 1, column: "left" },
  { id: "mains", label: "Mains", types: [10], equipped: [10], count: 1, column: "right" },
  { id: "taille", label: "Taille", types: [6], equipped: [6], count: 1, column: "right" },
  { id: "jambes", label: "Jambes", types: [7], equipped: [7], count: 1, column: "right" },
  { id: "pieds", label: "Pieds", types: [8], equipped: [8], count: 1, column: "right" },
  { id: "doigts", label: "Doigts", types: [11], equipped: [11, 12], count: 2, column: "right" },
  { id: "bijoux", label: "Bijoux", types: [12], equipped: [13, 14], count: 2, column: "right" },
  { id: "arme", label: "Arme principale", types: [13, 21, 17], equipped: [16], count: 1, column: "weapons" },
  { id: "main-gauche", label: "Main gauche", types: [13, 14, 22, 23], equipped: [17], count: 1, column: "weapons" },
  { id: "distance", label: "À distance", types: [15, 25, 26, 28], equipped: [18], count: 1, column: "weapons" },
];

/** Reliques à la place d'une arme à distance. */
const RELIC_CLASSES = new Set(["PALADIN", "DRUID", "SHAMAN"]);

/** Libellé d'un emplacement pour une classe : la relique remplace l'arme à distance du paladin, du druide et du chaman. */
export const slotLabel = (slot: PlannerSlot, classToken: string) => (slot.id === "distance" && RELIC_CLASSES.has(classToken) ? "Relique" : slot.label);

/** Niveau où la classe apprend l'ambidextrie (arme de main gauche), dans WoW Classic. */
const DUAL_WIELD: Readonly<Record<string, number>> = { ROGUE: 10, WARRIOR: 20, HUNTER: 20 };
const ONE_HAND_WEAPON = 13;
const OFF_HAND_WEAPON = 22;

const CLOTH = 1;
const LEATHER = 2;
const MAIL = 3;
const PLATE = 4;

/** Meilleur type d'armure que la classe porte à ce niveau : plaques et mailles s'apprennent au niveau 40. */
export function preferredArmor(classToken: string, level: number): number {
  const trained = level >= PROFICIENCY_LEVEL;
  switch (classToken) {
    case "WARRIOR":
    case "PALADIN":
      return trained ? PLATE : MAIL;
    case "HUNTER":
    case "SHAMAN":
      return trained ? MAIL : LEATHER;
    case "ROGUE":
    case "DRUID":
      return LEATHER;
    default:
      return CLOTH;
  }
}

type ArmorKind = Pick<ItemSpec, "itemClass" | "subclass">;
const isBodyArmor = (spec: ArmorKind) => spec.itemClass === ARMOR && spec.subclass >= CLOTH && spec.subclass <= PLATE;

export type PlannerState = {
  /** Classe (« MAGE ») ou identifiant de personnage, ou vide. */
  target: string;
  /** Niveau (« 42 ») ; vide : celui du personnage, sinon MAX_LEVEL. */
  level: string;
  places: InventoryPlace[];
  /** Seulement le meilleur type d'armure de la classe (plaques pour un guerrier de niveau 40). */
  ownArmor: boolean;
  /** Personnage choisi : seulement ce qui est meilleur que ce qu'il porte. */
  upgrades: boolean;
};

/** Enchères exclues par défaut : un objet en vente n'est pas disponible. */
export const DEFAULT_PLANNER_PLACES: readonly InventoryPlace[] = ["bags", "bank", "mail", "guild"];

export const DEFAULT_PLANNER_STATE: PlannerState = { target: "", level: "", places: [...DEFAULT_PLANNER_PLACES], ownArmor: false, upgrades: false };

const PARAMS = { target: "pour", level: "niveau", places: "lieux", ownArmor: "armure", upgrades: "ameliorations" } as const;
const PLACE_VALUES: Record<InventoryPlace, string> = { bags: "sacs", bank: "banque", mail: "courrier", auctions: "encheres", guild: "guilde" };

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value) => b.includes(value));

/** État lu dans l'adresse ; une valeur illisible garde sa valeur par défaut. */
export function readPlannerState(params: { get(name: string): string | null }): PlannerState {
  const level = params.get(PARAMS.level);
  const placesValue = params.get(PARAMS.places);
  const places = placesValue === null ? [...DEFAULT_PLANNER_PLACES] : PLACES.filter((place) => placesValue.split(",").includes(PLACE_VALUES[place]));
  return {
    target: readWearer(params.get(PARAMS.target)),
    level: level !== null && /^\d{1,2}$/.test(level) && Number(level) >= 1 && Number(level) <= MAX_LEVEL ? String(Number(level)) : "",
    places: places.length === 0 ? [...DEFAULT_PLANNER_PLACES] : places,
    ownArmor: params.get(PARAMS.ownArmor) === "1",
    upgrades: params.get(PARAMS.upgrades) === "1",
  };
}

/** Chaîne de requête (« ?… », ou vide) qui porte l'état ; les autres paramètres restent. */
export function writePlannerState(state: PlannerState, current = ""): string {
  const params = new URLSearchParams(current);
  for (const name of Object.values(PARAMS)) params.delete(name);
  if (state.target !== "") params.set(PARAMS.target, CLASS_SLUGS[state.target] ?? state.target);
  if (state.level !== "") params.set(PARAMS.level, state.level);
  if (!sameSet(state.places, DEFAULT_PLANNER_PLACES)) {
    params.set(PARAMS.places, PLACES.filter((place) => state.places.includes(place)).map((place) => PLACE_VALUES[place]).join(","));
  }
  if (state.ownArmor) params.set(PARAMS.ownArmor, "1");
  if (state.upgrades) params.set(PARAMS.upgrades, "1");
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** Pour qui l'on cherche : une classe de Classic à un niveau, et le personnage s'il a été choisi. */
export type PlannerTarget = { classToken: string; level: number; character: InventoryCharacter | null };

export function plannerTarget(state: PlannerState, characters: readonly InventoryCharacter[]): PlannerTarget | null {
  const chosen = state.level === "" ? null : Number(state.level);
  if (CLASSIC_CLASSES.includes(state.target)) return { classToken: state.target, level: chosen ?? MAX_LEVEL, character: null };
  const character = characters.find((candidate) => String(candidate.id) === state.target);
  if (!character || character.class === null || !CLASSIC_CLASSES.includes(character.class)) return null;
  return { classToken: character.class, level: chosen ?? Math.min(character.level ?? MAX_LEVEL, MAX_LEVEL), character };
}

/** Un objet trouvé : où il est, et son écart de niveau d'objet avec ce que porte le personnage. */
export type Candidate = {
  itemKey: string;
  name: string | null;
  quality: number | null;
  icon: string | null;
  spec: GearSpec;
  /** Ses exemplaires disponibles, ceux du personnage choisi d'abord, puis dans l'ordre des endroits. */
  holdings: Holding[];
  /** Lié quand ramassé : seul son détenteur peut le porter. */
  bound: boolean;
};

export type SlotPick = Candidate & { delta: number | null };

export type SlotPlan = {
  slot: PlannerSlot;
  label: string;
  /** Ce que porte le personnage choisi à cet emplacement ; vide pour une classe. */
  equipped: EquippedItem[];
  /** Les meilleurs objets, un par objet porté (deux pour les anneaux et les bijoux). */
  picks: SlotPick[];
  /** Les choix suivants, du meilleur au moins bon. */
  others: Candidate[];
};

export type GearPlan = { target: PlannerTarget; slots: SlotPlan[]; upgrades: number; found: number };

const isExpired = (holding: Holding, now: Date) =>
  holding.kind === "character" && holding.expiresAt !== null && new Date(holding.expiresAt).getTime() <= now.getTime();

/** Une arme de main gauche, ou à une main tenue en main gauche, demande l'ambidextrie. */
function fitsSlot(spec: GearSpec, slot: PlannerSlot, target: PlannerTarget): boolean {
  if (!slot.types.includes(spec.inventoryType)) return false;
  const offHand = spec.inventoryType === OFF_HAND_WEAPON || (slot.id === "main-gauche" && spec.inventoryType === ONE_HAND_WEAPON);
  if (offHand) return target.level >= (DUAL_WIELD[target.classToken] ?? Number.POSITIVE_INFINITY);
  return true;
}

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Niveaux d'objet retirés par rang d'armure sous le meilleur type de la classe : un guerrier de
 * niveau 45 préfère des plaques de niveau 33 à des mailles de niveau 40, pas à des mailles de 44.
 */
export const ARMOR_TIER_COST = 10;

/** Niveau d'objet, moins le coût d'une armure plus légère que celle de la classe. */
export function gearScore(spec: ArmorKind & { itemLevel: number | null }, own: number): number | null {
  if (spec.itemLevel === null) return null;
  return isBodyArmor(spec) ? spec.itemLevel - ARMOR_TIER_COST * Math.max(0, own - spec.subclass) : spec.itemLevel;
}

/**
 * Score d'abord, niveau d'objet inconnu en dernier ; à égalité, le meilleur type d'armure de la
 * classe, puis la qualité et le nom.
 */
function compareCandidates(target: PlannerTarget) {
  const own = preferredArmor(target.classToken, target.level);
  const armorRank = (spec: GearSpec) => (isBodyArmor(spec) && spec.subclass !== own ? 1 : 0);
  const score = (spec: GearSpec) => gearScore(spec, own) ?? Number.NEGATIVE_INFINITY;
  return (a: Candidate, b: Candidate) =>
    score(b.spec) - score(a.spec) ||
    armorRank(a.spec) - armorRank(b.spec) ||
    (b.quality ?? -1) - (a.quality ?? -1) ||
    collator.compare(fold(a.name ?? a.itemKey), fold(b.name ?? b.itemKey));
}

/**
 * Scores des objets portés d'un emplacement, du plus faible au plus fort, inconnus en dernier ; un
 * emplacement vide compte pour 0. Un objet porté absent de item_specs garde son niveau d'objet.
 */
function baseline(equipped: readonly EquippedItem[], count: number, own: number): (number | null)[] {
  const scores = equipped.map((item) => (item.spec ? gearScore({ ...item.spec, itemLevel: item.itemLevel }, own) : item.itemLevel));
  while (scores.length < count) scores.push(0);
  return scores.sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY)).slice(0, count);
}

/** Alternatives montrées sous les meilleurs choix d'un emplacement. */
export const OTHERS_SHOWN = 4;

/**
 * Le meilleur équipement en réserve pour la cible, emplacement par emplacement. Un objet lié quand
 * ramassé ne compte que chez le personnage choisi, ou, pour une classe, chez un personnage de
 * cette classe. Les courriers et ventes échus sont écartés.
 */
export function planGear(data: GearPlannerData, state: PlannerState, now: Date): GearPlan | null {
  const target = plannerTarget(state, data.characters);
  if (!target) return null;
  const classOf = new Map(data.characters.map((character) => [character.id, character.class]));
  const own = preferredArmor(target.classToken, target.level);

  // Exemplaires disponibles de chaque équipement que la cible peut porter.
  const byItem = new Map<string, Candidate>();
  const usable = new Map<string, boolean>();
  const add = (holding: Holding) => {
    if (!state.places.includes(holdingPlace(holding)) || isExpired(holding, now)) return;
    const info = data.items[holding.itemKey];
    const spec = info?.gear;
    if (!spec) return;
    let ok = usable.get(holding.itemKey);
    if (ok === undefined) {
      ok = canUse(spec, target.classToken, target.level) && (!state.ownArmor || !isBodyArmor(spec) || spec.subclass === own);
      usable.set(holding.itemKey, ok);
    }
    if (!ok) return;
    const bound = boundToHolder(spec);
    if (bound) {
      if (holding.kind !== "character") return;
      if (target.character ? holding.characterId !== target.character.id : classOf.get(holding.characterId) !== target.classToken) return;
    }
    let candidate = byItem.get(holding.itemKey);
    if (!candidate) {
      candidate = { itemKey: holding.itemKey, name: info.name, quality: info.quality, icon: info.icon, spec, holdings: [], bound };
      byItem.set(holding.itemKey, candidate);
    }
    candidate.holdings.push(holding);
  };
  for (const entry of data.entries) add({ kind: "character", ...entry });
  for (const guild of data.guilds) for (const tab of guild.tabs) for (const item of tab.items) add({ kind: "guild", itemKey: item.itemKey, guildId: guild.id, tab: tab.index, quantity: item.quantity });

  const mine = target.character?.id;
  const holdingRank = (holding: Holding) => (holding.kind === "character" && holding.characterId === mine ? -1 : PLACES.indexOf(holdingPlace(holding)));
  for (const candidate of byItem.values()) candidate.holdings.sort((a, b) => holdingRank(a) - holdingRank(b) || b.quantity - a.quantity);

  const compare = compareCandidates(target);
  const worn = target.character ? (data.equipment[String(target.character.id)] ?? []) : [];
  // Exemplaires déjà proposés : une arme à une main ne va pas à la fois en main droite et en main gauche.
  const used = new Map<string, number>();
  const copies = (candidate: Candidate) => candidate.holdings.reduce((sum, holding) => sum + Math.max(1, holding.quantity), 0) - (used.get(candidate.itemKey) ?? 0);
  let upgrades = 0;
  let found = 0;
  const slots = PLANNER_SLOTS.map((slot): SlotPlan => {
    const equipped = worn.filter((item) => slot.equipped.includes(item.slot));
    const floor = target.character ? baseline(equipped, slot.count, own) : [];
    // Écart de score avec l'objet porté qu'il remplacerait ; null si l'un des deux est inconnu.
    const better = (candidate: Candidate, index: number) => {
      const reference = floor[Math.min(index, floor.length - 1)];
      const score = gearScore(candidate.spec, own);
      return reference === undefined || reference === null || score === null ? null : score - reference;
    };
    let candidates = [...byItem.values()].filter((candidate) => fitsSlot(candidate.spec, slot, target) && copies(candidate) > 0).sort(compare);
    // Améliorations seulement : plus fort que l'objet porté le plus faible de l'emplacement. Face à un
    // objet porté au niveau inconnu, rien n'est écarté.
    if (state.upgrades && target.character && floor[0] !== null) candidates = candidates.filter((candidate) => (better(candidate, 0) ?? 0) > 0);
    found += candidates.length;
    // Deux anneaux ou deux bijoux : un objet détenu en deux exemplaires peut occuper les deux places.
    const chosen: Candidate[] = [];
    for (const candidate of candidates) {
      while (chosen.length < slot.count && copies(candidate) > 0) {
        chosen.push(candidate);
        used.set(candidate.itemKey, (used.get(candidate.itemKey) ?? 0) + 1);
      }
      if (chosen.length === slot.count) break;
    }
    const picks = chosen.map((candidate, index) => ({ ...candidate, delta: better(candidate, index) }));
    upgrades += picks.filter((pick) => pick.delta !== null && pick.delta > 0).length;
    const others = candidates.filter((candidate) => !chosen.includes(candidate)).slice(0, OTHERS_SHOWN);
    return { slot, label: slotLabel(slot, target.classToken), equipped, picks, others };
  });
  return { target, slots, upgrades, found };
}

/** Données réduites à l'équipement : seuls les objets décrits comme armure ou arme restent. */
export function gearOnly(data: InventoryData): Pick<InventoryData, "characters" | "entries" | "guilds" | "items"> {
  const items = Object.fromEntries(Object.entries(data.items).filter(([, info]) => info.gear?.itemClass === ARMOR || info.gear?.itemClass === WEAPON));
  return {
    characters: data.characters,
    entries: data.entries.filter((entry) => entry.itemKey in items),
    guilds: data.guilds.map((guild) => ({ ...guild, tabs: guild.tabs.map((tab) => ({ ...tab, items: tab.items.filter((item) => item.itemKey in items) })) })),
    items,
  };
}
