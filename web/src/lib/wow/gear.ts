import { CLASS_LABELS } from "./format";

// Équipement : type d'armure ou d'arme, emplacement, niveau requis et classes qui peuvent le porter.
// Les identifiants sont ceux des tables Item et ItemSparse du jeu (ClassID, SubclassID,
// InventoryType, AllowableClass). Les règles de port sont celles de WoW Classic.

export const ARMOR = 4;
export const WEAPON = 2;

/** Caractéristiques d'un équipement ; les niveaux sont null quand le jeu ne les publie pas. */
export type GearSpec = {
  itemClass: typeof ARMOR | typeof WEAPON;
  subclass: number;
  inventoryType: number;
  itemLevel: number | null;
  requiredLevel: number | null;
  /** Masque des classes autorisées (bit de l'identifiant de classe − 1) ; null pour toutes. */
  allowableClass: number | null;
};

/** Caractéristiques d'un objet quelconque de la table Item : classe, sous-classe, emplacement, niveaux. */
export type ItemSpec = Omit<GearSpec, "itemClass"> & { itemClass: number };

/** Vrai pour une armure ou une arme. */
export const isGear = (spec: ItemSpec | undefined): spec is GearSpec => spec?.itemClass === ARMOR || spec?.itemClass === WEAPON;

/** Identifiants des classes de WoW Classic (ChrClasses). */
export const CLASS_IDS: Readonly<Record<string, number>> = {
  WARRIOR: 1,
  PALADIN: 2,
  HUNTER: 3,
  ROGUE: 4,
  PRIEST: 5,
  SHAMAN: 7,
  MAGE: 8,
  WARLOCK: 9,
  DRUID: 11,
};
export const CLASSIC_CLASSES = Object.keys(CLASS_IDS);
/** Toutes les classes de Classic : un masque qui les couvre ne restreint rien. */
export const ALL_CLASSIC_CLASSES = Object.values(CLASS_IDS).reduce((mask, id) => mask | (1 << (id - 1)), 0);

/** Masque lu dans la table du jeu : null quand il autorise toutes les classes de Classic. */
export function classMask(value: number): number | null {
  if (value <= 0 || (value & ALL_CLASSIC_CLASSES) === ALL_CLASSIC_CLASSES) return null;
  return value & ALL_CLASSIC_CLASSES;
}

const ARMOR_LABELS: Record<number, string> = {
  0: "Divers",
  1: "Tissu",
  2: "Cuir",
  3: "Mailles",
  4: "Plaques",
  5: "Cosmétique",
  6: "Bouclier",
  7: "Libram",
  8: "Idole",
  9: "Totem",
};
const WEAPON_LABELS: Record<number, string> = {
  0: "Hache",
  1: "Hache",
  2: "Arc",
  3: "Arme à feu",
  4: "Masse",
  5: "Masse",
  6: "Arme d'hast",
  7: "Épée",
  8: "Épée",
  9: "Glaive",
  10: "Bâton",
  13: "Arme de pugilat",
  14: "Divers",
  15: "Dague",
  16: "Arme de jet",
  17: "Lance",
  18: "Arbalète",
  19: "Baguette",
  20: "Canne à pêche",
};
const SLOT_TYPE_LABELS: Record<number, string> = {
  1: "Tête",
  2: "Cou",
  3: "Épaules",
  4: "Chemise",
  5: "Torse",
  6: "Taille",
  7: "Jambes",
  8: "Pieds",
  9: "Poignets",
  10: "Mains",
  11: "Doigt",
  12: "Bijou",
  13: "Une main",
  14: "Main gauche",
  15: "À distance",
  16: "Dos",
  17: "Deux mains",
  19: "Tabard",
  20: "Torse",
  21: "Main droite",
  22: "Main gauche",
  23: "Tenu en main gauche",
  25: "Armes de jet",
  26: "À distance",
  28: "Relique",
};

/** Emplacement, comme en tête de la bulle du jeu : « Torse », « Deux mains ». */
export const gearSlotLabel = (spec: GearSpec): string | null => SLOT_TYPE_LABELS[spec.inventoryType] ?? null;

/** Type d'armure ou d'arme : « Cuir », « Épée ». Null pour un bijou, un anneau ou un collier, comme en jeu. */
export function gearTypeLabel(spec: GearSpec): string | null {
  if (spec.itemClass === ARMOR && spec.subclass === 0) return null;
  return (spec.itemClass === ARMOR ? ARMOR_LABELS : WEAPON_LABELS)[spec.subclass] ?? null;
}

/** « Torse · Cuir », « Deux mains · Épée », « Doigt ». */
export function gearLabel(spec: GearSpec): string {
  return [gearSlotLabel(spec), gearTypeLabel(spec)].filter(Boolean).join(" · ") || "Équipement";
}

/** Classes autorisées par l'objet lui-même (« Paladin, Guerrier »), ou null s'il n'en restreint aucune. */
export function allowedClassesLabel(spec: GearSpec): string | null {
  if (spec.allowableClass === null) return null;
  const names = CLASSIC_CLASSES.filter((token) => spec.allowableClass! & (1 << (CLASS_IDS[token] - 1))).map((token) => CLASS_LABELS[token] ?? token);
  return names.length === 0 ? null : names.join(", ");
}

// Types proposés au filtre : une valeur d'adresse, un libellé, et ce qu'elle retient.
type TypeOption = { value: string; label: string; itemClass: number; subclasses: readonly number[] | null };

export const ARMOR_TYPES: readonly TypeOption[] = [
  { value: "armure", label: "Toute armure", itemClass: ARMOR, subclasses: null },
  { value: "tissu", label: "Tissu", itemClass: ARMOR, subclasses: [1] },
  { value: "cuir", label: "Cuir", itemClass: ARMOR, subclasses: [2] },
  { value: "mailles", label: "Mailles", itemClass: ARMOR, subclasses: [3] },
  { value: "plaques", label: "Plaques", itemClass: ARMOR, subclasses: [4] },
  { value: "bouclier", label: "Boucliers", itemClass: ARMOR, subclasses: [6] },
  { value: "divers", label: "Bijoux et divers", itemClass: ARMOR, subclasses: [0, 5] },
  { value: "relique", label: "Reliques (libram, idole, totem)", itemClass: ARMOR, subclasses: [7, 8, 9] },
];
export const WEAPON_TYPES: readonly TypeOption[] = [
  { value: "arme", label: "Toute arme", itemClass: WEAPON, subclasses: null },
  { value: "epee-1m", label: "Épées à une main", itemClass: WEAPON, subclasses: [7] },
  { value: "epee-2m", label: "Épées à deux mains", itemClass: WEAPON, subclasses: [8] },
  { value: "hache-1m", label: "Haches à une main", itemClass: WEAPON, subclasses: [0] },
  { value: "hache-2m", label: "Haches à deux mains", itemClass: WEAPON, subclasses: [1] },
  { value: "masse-1m", label: "Masses à une main", itemClass: WEAPON, subclasses: [4] },
  { value: "masse-2m", label: "Masses à deux mains", itemClass: WEAPON, subclasses: [5] },
  { value: "dague", label: "Dagues", itemClass: WEAPON, subclasses: [15] },
  { value: "pugilat", label: "Armes de pugilat", itemClass: WEAPON, subclasses: [13] },
  { value: "hast", label: "Armes d'hast", itemClass: WEAPON, subclasses: [6] },
  { value: "baton", label: "Bâtons", itemClass: WEAPON, subclasses: [10] },
  { value: "arc", label: "Arcs", itemClass: WEAPON, subclasses: [2] },
  { value: "fusil", label: "Armes à feu", itemClass: WEAPON, subclasses: [3] },
  { value: "arbalete", label: "Arbalètes", itemClass: WEAPON, subclasses: [18] },
  { value: "baguette", label: "Baguettes", itemClass: WEAPON, subclasses: [19] },
  { value: "jet", label: "Armes de jet", itemClass: WEAPON, subclasses: [16] },
  { value: "canne", label: "Cannes à pêche", itemClass: WEAPON, subclasses: [20] },
];
const TYPES = [...ARMOR_TYPES, ...WEAPON_TYPES];

/** Emplacements proposés au filtre, chacun avec les InventoryType du jeu qu'il regroupe. */
export const GEAR_SLOTS: readonly { value: string; label: string; types: readonly number[] }[] = [
  { value: "tete", label: "Tête", types: [1] },
  { value: "cou", label: "Cou", types: [2] },
  { value: "epaules", label: "Épaules", types: [3] },
  { value: "dos", label: "Dos", types: [16] },
  { value: "torse", label: "Torse", types: [5, 20] },
  { value: "chemise", label: "Chemise", types: [4] },
  { value: "tabard", label: "Tabard", types: [19] },
  { value: "poignets", label: "Poignets", types: [9] },
  { value: "mains", label: "Mains", types: [10] },
  { value: "taille", label: "Taille", types: [6] },
  { value: "jambes", label: "Jambes", types: [7] },
  { value: "pieds", label: "Pieds", types: [8] },
  { value: "doigt", label: "Doigt", types: [11] },
  { value: "bijou", label: "Bijou", types: [12] },
  { value: "main-droite", label: "Une main, main droite", types: [13, 21] },
  { value: "deux-mains", label: "Deux mains", types: [17] },
  { value: "main-gauche", label: "Main gauche", types: [14, 22, 23] },
  { value: "distance", label: "À distance", types: [15, 25, 26] },
  { value: "relique", label: "Relique", types: [28] },
];

export const isGearType = (value: string) => TYPES.some((type) => type.value === value);
export const isGearSlot = (value: string) => GEAR_SLOTS.some((slot) => slot.value === value);

export function matchesGearType(spec: GearSpec, value: string): boolean {
  const type = TYPES.find((candidate) => candidate.value === value);
  if (!type) return true;
  return spec.itemClass === type.itemClass && (type.subclasses === null || type.subclasses.includes(spec.subclass));
}

export function matchesGearSlot(spec: GearSpec, value: string): boolean {
  const slot = GEAR_SLOTS.find((candidate) => candidate.value === value);
  return !slot || slot.types.includes(spec.inventoryType);
}

// Armes que chaque classe peut apprendre dans WoW Classic (sous-classes de l'arme). Divers (14) et
// canne à pêche (20) : toutes les classes.
const WEAPON_SKILLS: Readonly<Record<string, readonly number[]>> = {
  WARRIOR: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 15, 16, 18],
  PALADIN: [0, 1, 4, 5, 6, 7, 8],
  HUNTER: [0, 1, 2, 3, 6, 7, 8, 10, 13, 15, 16, 18],
  ROGUE: [2, 3, 4, 7, 13, 15, 16, 18],
  PRIEST: [4, 10, 15, 19],
  SHAMAN: [0, 1, 4, 5, 10, 13, 15],
  MAGE: [7, 10, 15, 19],
  WARLOCK: [7, 10, 15, 19],
  DRUID: [4, 5, 10, 13, 15],
};
const LEATHER = new Set(["WARRIOR", "PALADIN", "HUNTER", "ROGUE", "SHAMAN", "DRUID"]);
/** Mailles et plaques s'apprennent au niveau 40 pour ces classes. */
const MAIL = { always: new Set(["WARRIOR", "PALADIN"]), at40: new Set(["HUNTER", "SHAMAN"]) };
const PLATE_AT_40 = new Set(["WARRIOR", "PALADIN"]);
const SHIELD = new Set(["WARRIOR", "PALADIN", "SHAMAN"]);
const RELIC: Readonly<Record<number, string>> = { 7: "PALADIN", 8: "DRUID", 9: "SHAMAN" };
export const PROFICIENCY_LEVEL = 40;

/**
 * La classe peut-elle porter cet objet ? Avec un niveau (un personnage), les mailles et plaques
 * apprises au niveau 40 et le niveau requis comptent aussi ; sans niveau (une classe), ce qu'elle
 * pourra porter un jour.
 */
export function canUse(spec: GearSpec, classToken: string, level: number | null = null): boolean {
  const id = CLASS_IDS[classToken];
  if (id === undefined) return false;
  if (spec.allowableClass !== null && (spec.allowableClass & (1 << (id - 1))) === 0) return false;
  if (level !== null && spec.requiredLevel !== null && spec.requiredLevel > level) return false;
  const trained = level === null || level >= PROFICIENCY_LEVEL;
  if (spec.itemClass === WEAPON) {
    if (spec.subclass === 14 || spec.subclass === 20) return true;
    return WEAPON_SKILLS[classToken]?.includes(spec.subclass) ?? false;
  }
  switch (spec.subclass) {
    case 2:
      return LEATHER.has(classToken);
    case 3:
      return MAIL.always.has(classToken) || (MAIL.at40.has(classToken) && trained);
    case 4:
      return PLATE_AT_40.has(classToken) && trained;
    case 6:
      return SHIELD.has(classToken);
    case 7:
    case 8:
    case 9:
      return RELIC[spec.subclass] === classToken;
    default:
      // Tissu, divers, cosmétique : toutes les classes.
      return true;
  }
}
