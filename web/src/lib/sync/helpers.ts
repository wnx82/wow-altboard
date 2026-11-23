// Outils communs de l'import : lots d'insertion, dédoublonnage et dates Unix.

/** Lots d'au plus `size` éléments, dans l'ordre. */
export function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

/** Une valeur par clé : la dernière l'emporte, à la place de la première. */
export function uniqueBy<T>(values: readonly T[], key: (value: T) => string | number): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

/** Date d'un horodatage Unix en secondes, tel que l'écrivent les addons. */
export const fromUnix = (seconds: number) => new Date(seconds * 1000);
