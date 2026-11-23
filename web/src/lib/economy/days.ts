// Jours Auctionator : nombre de jours depuis le 2020-01-01 (SCAN_DAY_0 de l'addon), compté sur
// l'heure locale du PC de jeu. Le jour est la seule granularité que l'addon conserve : aucune
// heure de relevé n'existe dans le fichier.

import { brusselsDay } from "@/lib/wow/format";

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(2020, 0, 1);

/** Jour Auctionator → date ISO (AAAA-MM-JJ). */
export function auctionDayToDate(day: number): string {
  return new Date(EPOCH + day * DAY_MS).toISOString().slice(0, 10);
}

/** Date ISO (AAAA-MM-JJ) → jour Auctionator. */
export function dateToAuctionDay(date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - EPOCH) / DAY_MS);
}

/** Nombre de jours entre deux dates ISO (b − a). */
export function daysBetween(a: string, b: string): number {
  return dateToAuctionDay(b) - dateToAuctionDay(a);
}

/** Date ISO du jour, dans le fuseau du joueur, comme les jours d'Auctionator. */
export function todayInBrussels(now: Date): string {
  return brusselsDay(now);
}

/** Date ISO décalée de n jours. */
export function addDays(date: string, n: number): string {
  return auctionDayToDate(dateToAuctionDay(date) + n);
}
