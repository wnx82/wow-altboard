// Fiche d'équipement à la manière de la fenêtre Personnage du jeu : huit emplacements à gauche, huit à
// droite, les trois armes en bas. Les numéros sont ceux du jeu (1 à 19), relevés par l'addon.

export type PaperdollColumn = "left" | "right" | "weapons";

/** Emplacements de chaque colonne, de haut en bas (de gauche à droite pour les armes), dans l'ordre du jeu. */
export const PAPERDOLL_COLUMNS: Readonly<Record<PaperdollColumn, readonly number[]>> = {
  left: [1, 2, 3, 15, 5, 4, 19, 9],
  right: [10, 6, 7, 8, 11, 12, 13, 14],
  weapons: [16, 17, 18],
};

/** Chemise et tabard : purement décoratifs, ils ne comptent pas dans les emplacements à garnir. */
export const COSMETIC_SLOTS: ReadonlySet<number> = new Set([4, 19]);

export type PaperdollCell<T> = { slot: number; item: T | null };

/** Place chaque objet porté dans sa colonne ; un emplacement sans objet reste présent, vide. */
export function layoutPaperdoll<T extends { slot: number }>(items: readonly T[]): Record<PaperdollColumn, PaperdollCell<T>[]> {
  const bySlot = new Map(items.map((item) => [item.slot, item]));
  const column = (slots: readonly number[]) => slots.map((slot) => ({ slot, item: bySlot.get(slot) ?? null }));
  return { left: column(PAPERDOLL_COLUMNS.left), right: column(PAPERDOLL_COLUMNS.right), weapons: column(PAPERDOLL_COLUMNS.weapons) };
}

/** Objets portés par qualité, de la plus haute à la plus basse ; une qualité inconnue n'est pas comptée. */
export function countByQuality(items: readonly { quality: number | null }[]): { quality: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const { quality } of items) if (quality !== null) counts.set(quality, (counts.get(quality) ?? 0) + 1);
  return [...counts].map(([quality, count]) => ({ quality, count })).sort((a, b) => b.quality - a.quality);
}

/** Emplacements utiles garnis, chemise et tabard mis à part : « 15 sur 17 ». */
export function filledSlots(items: readonly { slot: number }[]): { filled: number; total: number } {
  const useful = new Set(items.map((item) => item.slot).filter((slot) => !COSMETIC_SLOTS.has(slot)));
  const total = Object.values(PAPERDOLL_COLUMNS).flat().length - COSMETIC_SLOTS.size;
  return { filled: useful.size, total };
}
