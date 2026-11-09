import type { Parsed } from "@/lib/settings/input";

// Montant saisi dans un formulaire, rendu en pièces de cuivre. Formes acceptées : un nombre de
// pièces d'or (« 12 », « 12,5 »), ou des unités (« 12 po 50 pa 3 pc », « 50 pa », « 1g 20s »).
// Les séparateurs de milliers (espace, espace insécable) sont tolérés : « 1 200 po ».

/** Plus haut montant accepté : un million de pièces d'or. */
export const MAX_MONEY_COPPER = 1_000_000 * 10_000;

const UNITS: Record<string, number> = { po: 10_000, g: 10_000, pa: 100, s: 100, pc: 1, c: 1 };
const GOLD_ONLY = /^\d{1,7}(?:[.,]\d{1,4})?$/;
// « 12po50pa » : l'unité est suivie d'autre chose qu'une lettre, pas forcément d'une espace.
const WITH_UNITS = /^(?:\s*\d{1,7}\s*(?:po|pa|pc|g|s|c)(?![a-z]))+\s*$/;
const PART = /(\d{1,7})\s*(po|pa|pc|g|s|c)(?![a-z])/g;

export const MONEY_INPUT_HINT = "par exemple 12,5 ou 12 po 50 pa";

/** Vide : null (aucun montant). Un montant nul ou au-delà de MAX_MONEY_COPPER est refusé. */
export function parseMoneyInput(raw: string): Parsed<number | null> {
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/[  ]/g, " ")
    // « 1 200 po » : l'espace entre chiffres est un séparateur de milliers.
    .replace(/(\d) (?=\d{3}(?!\d))/g, "$1");
  if (value === "") return { ok: true, value: null };

  let copper: number;
  if (GOLD_ONLY.test(value)) {
    copper = Math.round(Number(value.replace(",", ".")) * 10_000);
  } else if (WITH_UNITS.test(value)) {
    const seen = new Set<number>();
    copper = 0;
    for (const [, amount, unit] of value.matchAll(PART)) {
      const factor = UNITS[unit];
      // Une même unité deux fois (« 1 po 2 po ») est une faute de frappe, pas une somme.
      if (seen.has(factor)) return { ok: false, error: `Montant invalide : ${MONEY_INPUT_HINT}.` };
      seen.add(factor);
      copper += Number(amount) * factor;
    }
  } else {
    return { ok: false, error: `Montant invalide : ${MONEY_INPUT_HINT}.` };
  }
  if (copper <= 0) return { ok: false, error: "Le montant doit être supérieur à zéro." };
  if (copper > MAX_MONEY_COPPER) return { ok: false, error: "Montant trop élevé : un million de pièces d'or au plus." };
  return { ok: true, value: copper };
}

/** Forme saisissable d'un montant, relue telle quelle par parseMoneyInput : « 12 po 50 pa ». */
export function formatMoneyInput(copper: number): string {
  const gold = Math.floor(copper / 10_000);
  const silver = Math.floor((copper % 10_000) / 100);
  const rest = copper % 100;
  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold} po`);
  if (silver > 0) parts.push(`${silver} pa`);
  if (rest > 0) parts.push(`${rest} pc`);
  return parts.join(" ") || "0 pc";
}
