// Libellés et mises en forme propres à World of Warcraft. AltBoard stocke le jeton de classe non
// localisé (MAGE) mais des races, zones et métiers déjà localisés : seuls les jetons sont traduits.

export const CLASS_LABELS: Record<string, string> = {
  WARRIOR: "Guerrier",
  PALADIN: "Paladin",
  HUNTER: "Chasseur",
  ROGUE: "Voleur",
  PRIEST: "Prêtre",
  DEATHKNIGHT: "Chevalier de la mort",
  SHAMAN: "Chaman",
  MAGE: "Mage",
  WARLOCK: "Démoniste",
  MONK: "Moine",
  DRUID: "Druide",
  DEMONHUNTER: "Chasseur de démons",
  EVOKER: "Évocateur",
};

/** Libellé de classe ; un jeton inconnu est affiché tel quel plutôt que deviné. */
export function classLabel(token: string | null): string {
  if (!token) return "Classe inconnue";
  return CLASS_LABELS[token] ?? token;
}

/** Jeton utilisable dans un attribut data-class (les couleurs vivent dans la feuille de style). */
export function classKey(token: string | null): string {
  return token && token in CLASS_LABELS ? token : "UNKNOWN";
}

export const QUALITY_LABELS = ["Médiocre", "Commun", "Inhabituel", "Rare", "Épique", "Légendaire", "Artefact", "Héritage"];

export const REACTION_LABELS: Record<number, string> = {
  1: "Détesté",
  2: "Hostile",
  3: "Inamical",
  4: "Neutre",
  5: "Amical",
  6: "Honoré",
  7: "Révéré",
  8: "Exalté",
};

export const SLOT_LABELS: Record<number, string> = {
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
  11: "Doigt 1",
  12: "Doigt 2",
  13: "Bijou 1",
  14: "Bijou 2",
  15: "Dos",
  16: "Main droite",
  17: "Main gauche",
  18: "À distance",
  19: "Tabard",
};

export type Money = { gold: number; silver: number; copper: number };

export function splitMoney(copper: number): Money {
  const value = Math.max(0, Math.floor(copper));
  return { gold: Math.floor(value / 10_000), silver: Math.floor((value % 10_000) / 100), copper: value % 100 };
}

const integer = new Intl.NumberFormat("fr-FR");

/** « 8 po 9 pa 64 pc » ; les unités nulles de tête sont omises. */
export function formatMoney(copper: number | null): string {
  if (copper === null) return "—";
  const money = splitMoney(copper);
  const parts: string[] = [];
  if (money.gold > 0) parts.push(`${integer.format(money.gold)} po`);
  if (money.gold > 0 || money.silver > 0) parts.push(`${money.silver} pa`);
  parts.push(`${money.copper} pc`);
  return parts.join(" ");
}

export function formatInteger(value: number | null): string {
  return value === null ? "—" : integer.format(value);
}

/** Niveau d'objet moyen : AltBoard fournit un flottant (15.9375), affiché à une décimale. */
export function formatItemLevel(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

/** Part entière d'une progression, bornée à 0–100 ; null si elle n'est pas calculable. */
export function progressPercent(current: number | null, max: number | null): number | null {
  if (current === null || max === null || max <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

/**
 * Niveau avec la part d'expérience acquise : 26,84 = niveau 26 à 84 %. Sans expérience connue, le
 * niveau seul. La part reste sous 1 : un niveau n'est franchi que par le jeu.
 */
export function fractionalLevel(level: number, xp: number | null, xpMax: number | null): number {
  if (xp === null || xpMax === null || xpMax <= 0) return level;
  return level + Math.max(0, Math.min(0.99, xp / xpMax));
}

/**
 * Fuseau du joueur : les jours, heures et semaines du site sont ceux de Bruxelles, comme les jours
 * d'Auctionator. Seule source de ce nom, côté pages comme côté requêtes SQL.
 */
export const PLAYER_TIME_ZONE = "Europe/Brussels";

const isoDay = new Intl.DateTimeFormat("en-CA", { timeZone: PLAYER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Jour civil ISO (« 2026-11-23 ») d'un instant, à l'heure de Bruxelles. */
export function brusselsDay(date: Date | string | number): string {
  return isoDay.format(new Date(date));
}

const dateTime = new Intl.DateTimeFormat("fr-BE", { dateStyle: "short", timeStyle: "short", timeZone: PLAYER_TIME_ZONE });

export function formatDateTime(date: Date | string | null): string {
  return date === null ? "—" : dateTime.format(new Date(date));
}

/** « 45 s », « 12 min », « 3 h 05 », « 1 h », « 2 j 4 h », « 1 j ». Les zéros de queue sont omis. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
  return hours % 24 === 0 ? `${Math.floor(hours / 24)} j` : `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

/** Comme formatDuration, minutes gardées au-delà d'un jour : « 2 j 4 h 07 ». Pour un cumul, où deux lignes voisines diffèrent de moins d'une heure. */
export function formatDurationToMinute(seconds: number | null): string {
  if (seconds === null || Math.round(seconds) < 86_400) return formatDuration(seconds);
  const minutes = Math.floor(Math.round(seconds) / 60);
  return `${Math.floor(minutes / 1440)} j ${Math.floor(minutes / 60) % 24} h ${String(minutes % 60).padStart(2, "0")}`;
}

const relative = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** « il y a 4 minutes », « hier », « à l'instant ». */
export function formatRelative(date: Date | string | null, now: Date = new Date()): string {
  if (date === null) return "jamais";
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return "à l'instant";
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return "à l'instant";
}
