// Catégories d'objets, à la manière du tri des sacs du jeu : classe et sous-classe de la table Item
// (ClassID, SubclassID), puis la qualité pour la camelote (objets gris), rangée à la fin.

/** `icon` : nom de fichier d'une icône du jeu, présente sur le CDN de Blizzard. */
export type ItemCategory = { value: string; label: string; group: string; icon: string };

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
  { value: "armes", label: "Armes", group: "Équipement", icon: "inv_sword_04" },
  { value: "armures", label: "Armures", group: "Équipement", icon: "inv_chest_chain" },
  { value: "sacs", label: "Sacs et carquois", group: "Équipement", icon: "inv_misc_bag_08" },
  { value: "nourriture", label: "Nourriture et boissons", group: "Consommables", icon: "inv_misc_food_15" },
  { value: "potions", label: "Potions", group: "Consommables", icon: "inv_potion_51" },
  { value: "elixirs", label: "Élixirs et flacons", group: "Consommables", icon: "inv_potion_61" },
  { value: "parchemins", label: "Parchemins", group: "Consommables", icon: "inv_scroll_03" },
  { value: "bandages", label: "Bandages", group: "Consommables", icon: "inv_misc_bandage_15" },
  { value: "ameliorations", label: "Améliorations d'objets", group: "Consommables", icon: "inv_misc_armorkit_17" },
  { value: "consommables", label: "Autres consommables", group: "Consommables", icon: "inv_misc_orb_01" },
  { value: "munitions", label: "Flèches et balles", group: "Consommables", icon: "inv_ammo_arrow_01" },
  { value: "tissu", label: "Tissu", group: "Artisanat", icon: "inv_fabric_linen_01" },
  { value: "cuir", label: "Cuir", group: "Artisanat", icon: "inv_misc_leatherscrap_03" },
  { value: "metal", label: "Métal et pierre", group: "Artisanat", icon: "inv_ore_copper_01" },
  { value: "viande", label: "Viande et poisson", group: "Artisanat", icon: "inv_misc_food_14" },
  { value: "herbes", label: "Herbes", group: "Artisanat", icon: "inv_misc_herb_07" },
  { value: "elementaire", label: "Élémentaire", group: "Artisanat", icon: "spell_fire_fire" },
  { value: "enchantement", label: "Enchantement", group: "Artisanat", icon: "inv_enchant_dustvision" },
  { value: "ingenierie", label: "Pièces et explosifs", group: "Artisanat", icon: "inv_misc_gear_01" },
  { value: "artisanat", label: "Autres composants", group: "Artisanat", icon: "inv_misc_birdbeck_01" },
  { value: "recettes", label: "Recettes et livres", group: "Artisanat", icon: "inv_misc_book_09" },
  { value: "reactifs", label: "Réactifs", group: "Autres", icon: "inv_misc_rune_05" },
  { value: "quete", label: "Quête", group: "Autres", icon: "inv_misc_note_01" },
  { value: "cles", label: "Clés", group: "Autres", icon: "inv_misc_key_03" },
  { value: "mascottes", label: "Mascottes et montures", group: "Autres", icon: "inv_box_petcarrier_01" },
  { value: "divers", label: "Divers", group: "Autres", icon: "inv_misc_coin_02" },
  { value: "camelote", label: "Camelote", group: "Autres", icon: "inv_misc_bone_humanskull_01" },
  { value: "inconnu", label: "Sans catégorie connue", group: "Autres", icon: "inv_misc_questionmark" },
];

/** Groupes de catégories, dans l'ordre d'affichage. */
export const CATEGORY_GROUPS = [...new Set(ITEM_CATEGORIES.map((category) => category.group))];

const ORDER = new Map(ITEM_CATEGORIES.map((category, index) => [category.value, index]));
const LABELS = new Map(ITEM_CATEGORIES.map((category) => [category.value, category.label]));
const ICONS = new Map(ITEM_CATEGORIES.map((category) => [category.value, category.icon]));
const GROUPS = new Map(ITEM_CATEGORIES.map((category) => [category.value, category.group]));

export const isItemCategory = (value: string) => ORDER.has(value);
/** Rang d'affichage d'une catégorie ; une valeur inconnue passe en dernier. */
export const categoryRank = (value: string | undefined) => ORDER.get(value ?? "inconnu") ?? ITEM_CATEGORIES.length;
export const categoryLabel = (value: string | undefined) => LABELS.get(value ?? "inconnu") ?? "Sans catégorie connue";
/** Groupe d'une catégorie (« Équipement », « Artisanat »…) ; une valeur inconnue va dans « Autres ». */
export const categoryGroup = (value: string | undefined) => GROUPS.get(value ?? "inconnu") ?? "Autres";
/** Icône d'une catégorie ; une valeur inconnue prend le point d'interrogation du jeu. */
export const categoryIcon = (value: string | undefined) => ICONS.get(value ?? "inconnu") ?? "inv_misc_questionmark";

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
