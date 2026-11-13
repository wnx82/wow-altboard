// Catégories d'objets, à la manière du tri des sacs du jeu : classe et sous-classe de la table Item
// (ClassID, SubclassID), puis la qualité pour la camelote (objets gris), rangée à la fin.

export type ItemCategory = { value: string; label: string; group: string };

/** Classe et sous-classe d'un objet, telles que la table Item du jeu les donne. */
export type ItemClassification = { itemClass: number; subclass: number };

const CONSUMABLE = 0;
const CONTAINER = 1;
const WEAPON = 2;
const GEM = 3;
const ARMOR = 4;
const REAGENT = 5;
const PROJECTILE = 6;
const TRADE_GOODS = 7;
const RECIPE = 9;
const QUIVER = 11;
const QUEST = 12;
const KEY = 13;
const MISCELLANEOUS = 15;

/** Dans l'ordre d'affichage. */
export const ITEM_CATEGORIES: readonly ItemCategory[] = [
  { value: "armes", label: "Armes", group: "Équipement" },
  { value: "armures", label: "Armures", group: "Équipement" },
  { value: "sacs", label: "Sacs et carquois", group: "Équipement" },
  { value: "nourriture", label: "Nourriture et boissons", group: "Consommables" },
  { value: "potions", label: "Potions", group: "Consommables" },
  { value: "elixirs", label: "Élixirs et flacons", group: "Consommables" },
  { value: "parchemins", label: "Parchemins", group: "Consommables" },
  { value: "bandages", label: "Bandages", group: "Consommables" },
  { value: "ameliorations", label: "Améliorations d'objets", group: "Consommables" },
  { value: "consommables", label: "Autres consommables", group: "Consommables" },
  { value: "munitions", label: "Flèches et balles", group: "Consommables" },
  { value: "tissu", label: "Tissu", group: "Artisanat" },
  { value: "cuir", label: "Cuir", group: "Artisanat" },
  { value: "metal", label: "Métal et pierre", group: "Artisanat" },
  { value: "viande", label: "Viande et poisson", group: "Artisanat" },
  { value: "herbes", label: "Herbes", group: "Artisanat" },
  { value: "elementaire", label: "Élémentaire", group: "Artisanat" },
  { value: "enchantement", label: "Enchantement", group: "Artisanat" },
  { value: "ingenierie", label: "Pièces et explosifs", group: "Artisanat" },
  { value: "artisanat", label: "Autres composants", group: "Artisanat" },
  { value: "recettes", label: "Recettes et livres", group: "Artisanat" },
  { value: "reactifs", label: "Réactifs", group: "Autres" },
  { value: "quete", label: "Quête", group: "Autres" },
  { value: "cles", label: "Clés", group: "Autres" },
  { value: "mascottes", label: "Mascottes et montures", group: "Autres" },
  { value: "divers", label: "Divers", group: "Autres" },
  { value: "camelote", label: "Camelote", group: "Autres" },
  { value: "inconnu", label: "Sans catégorie connue", group: "Autres" },
];

/** Groupes de catégories, dans l'ordre d'affichage. */
export const CATEGORY_GROUPS = [...new Set(ITEM_CATEGORIES.map((category) => category.group))];

const ORDER = new Map(ITEM_CATEGORIES.map((category, index) => [category.value, index]));
const LABELS = new Map(ITEM_CATEGORIES.map((category) => [category.value, category.label]));

export const isItemCategory = (value: string) => ORDER.has(value);
/** Rang d'affichage d'une catégorie ; une valeur inconnue passe en dernier. */
export const categoryRank = (value: string | undefined) => ORDER.get(value ?? "inconnu") ?? ITEM_CATEGORIES.length;
export const categoryLabel = (value: string | undefined) => LABELS.get(value ?? "inconnu") ?? "Sans catégorie connue";

const CONSUMABLES: Readonly<Record<number, string>> = { 1: "potions", 2: "elixirs", 3: "elixirs", 4: "parchemins", 5: "nourriture", 6: "ameliorations", 7: "bandages" };
const TRADE: Readonly<Record<number, string>> = {
  1: "ingenierie",
  2: "ingenierie",
  3: "ingenierie",
  5: "tissu",
  6: "cuir",
  7: "metal",
  8: "viande",
  9: "herbes",
  10: "elementaire",
  12: "enchantement",
};

/**
 * Catégorie d'un objet. La camelote (qualité médiocre) l'emporte, comme dans les sacs du jeu ; une
 * mascotte relevée par sa clé (« p:… ») va avec les mascottes ; sans classe connue, « inconnu ».
 */
export function itemCategory(classification: ItemClassification | null | undefined, quality: number | null, itemKey = ""): string {
  if (quality === 0) return "camelote";
  if (itemKey.startsWith("p:")) return "mascottes";
  if (!classification) return "inconnu";
  const { itemClass, subclass } = classification;
  switch (itemClass) {
    case WEAPON:
      return "armes";
    case ARMOR:
      return "armures";
    case CONTAINER:
    case QUIVER:
      return "sacs";
    case CONSUMABLE:
      return CONSUMABLES[subclass] ?? "consommables";
    case PROJECTILE:
      return "munitions";
    case TRADE_GOODS:
      return TRADE[subclass] ?? "artisanat";
    case GEM:
      // Absentes de WoW Forever (aucun objet de classe 3) : rangées avec les autres composants.
      return "artisanat";
    case RECIPE:
      return "recettes";
    case REAGENT:
      return "reactifs";
    case QUEST:
      return "quete";
    case KEY:
      return "cles";
    case MISCELLANEOUS:
      if (subclass === 1) return "reactifs";
      if (subclass === 2 || subclass === 5) return "mascottes";
      return "divers";
    default:
      return "divers";
  }
}
