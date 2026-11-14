import { fold } from "./inventory-view";

// Filtres communs aux pages qui comparent les personnages (Réputations, Métiers, Activité) : un
// compte et un nom de personnage, lus dans l'adresse. Pur, sans base.

export type SearchParams = Record<string, string | string[] | undefined>;

/** Longueur gardée d'un texte cherché : au-delà, rien ne peut correspondre à un nom du jeu. */
export const MAX_FILTER_LENGTH = 40;

/** Première valeur d'un paramètre de l'adresse, chaîne vide en son absence. */
export function param(params: SearchParams, name: string): string {
  const value = params[name];
  return (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).slice(0, 200);
}

/** Identifiant positif écrit en chiffres, sinon null. */
export function idParam(params: SearchParams, name: string): number | null {
  const value = param(params, name);
  return /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

/** Texte cherché : tel que saisi (pour le formulaire), et replié sans accent ni majuscule. */
export type TextFilter = { raw: string; needle: string };

export function textParam(params: SearchParams, name: string): TextFilter {
  const raw = param(params, name).trim().slice(0, MAX_FILTER_LENGTH);
  return { raw, needle: fold(raw).replace(/\s+/g, " ") };
}

export const textMatches = (text: string, filter: TextFilter) => filter.needle === "" || fold(text).includes(filter.needle);

export type RosterFilter = { account: number | null; character: TextFilter };

export function readRosterFilter(params: SearchParams): RosterFilter {
  return { account: idParam(params, "account"), character: textParam(params, "character") };
}

export const rosterActive = (filter: RosterFilter) => filter.account !== null || filter.character.needle !== "";

/** Le personnage appartient au compte choisi et son nom contient le texte cherché. */
export function matchesRoster(character: { name: string; accountId: number }, filter: RosterFilter): boolean {
  return (filter.account === null || character.accountId === filter.account) && textMatches(character.name, filter.character);
}

export type AccountOption = { id: number; label: string };

/** Comptes des personnages reçus, une fois chacun, par ordre alphabétique. */
export function accountOptions(characters: readonly { accountId: number; account: string }[]): AccountOption[] {
  const byId = new Map<number, string>();
  for (const character of characters) byId.set(character.accountId, character.account);
  return [...byId].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}
