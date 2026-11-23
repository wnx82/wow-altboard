import { daysBetween } from "./days";

// Moteur de prix : statistiques d'un objet sur un hôtel des ventes, à partir des seuls relevés
// d'Auctionator (voir docs/ECONOMY-ENGINE.md). Fonctions pures : mêmes relevés, mêmes résultats.
//
// Un relevé journalier donne le plus bas et le plus haut des prix MINIMUMS vus ce jour-là, et la
// plus grande quantité en vente. Le prix de référence d'un jour est son plus bas, comme le fait
// Auctionator lui-même. Le nombre d'enchères n'est pas relevé par l'addon : il reste inconnu.

export type DayObservation = { day: string; low: number; high: number; available: number | null };
/** Dernier prix : at et source quand on les connaît (heure du scan, addon qui l'a relevé). */
export type LatestObservation = { minCopper: number; day: string; at?: Date | null; source?: "auctionator" | "ezauctioneer" };

export type ConfidenceFactors = { history: number; freshness: number; volume: number; stability: number };
export type Liquidity = "élevée" | "moyenne" | "faible" | "inconnue";

export type ItemStats = {
  itemKey: string;
  /**
   * Dernier prix vu, s'il est postérieur au début de l'historique : champ m d'Auctionator, ou
   * dernier scan d'EZAuctioneer quand il est plus récent.
   */
  current: { minCopper: number; day: string; ageDays: number; at: Date | null; source: "auctionator" | "ezauctioneer" } | null;
  lastDay: string | null;
  lastAvailable: number | null;
  daysObserved7: number;
  daysObserved30: number;
  median7: number | null;
  median30: number | null;
  weightedMean30: number | null;
  /** Valeur retenue pour valoriser l'objet : médiane des plus bas journaliers. */
  marketValue: number | null;
  marketValueBasis: "médiane 14 j" | "médiane 30 j" | "insuffisant";
  medianAvailable30: number | null;
  /** Variations en fraction (0,1 = +10 %), entre le dernier jour relevé et un jour antérieur. */
  change1d: number | null;
  change7d: number | null;
  change30d: number | null;
  /** Coefficient de variation robuste (1,4826 × MAD / médiane) des plus bas journaliers sur 30 jours. */
  volatility30: number | null;
  liquidity: Liquidity;
  /** Écart robuste du dernier prix à la médiane des jours précédents ; « outlier » au-delà de 3,5. */
  outlierScore: number | null;
  outlier: boolean;
  thinMarket: boolean;
  confidence: number;
  confidenceFactors: ConfidenceFactors;
};

export const MIN_DAYS_FOR_VALUE = 3;
const OUTLIER_THRESHOLD = 3.5;
/**
 * Plafond de confiance d'un marché à une ou deux unités en vente, ou relevé moins de trois jours :
 * jamais assez pour décider seul.
 */
export const THIN_MARKET_CONFIDENCE_CAP = 30;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Écart absolu médian. */
export function mad(values: readonly number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Variation relative de a vers b, ou null si a est nul ou absent. */
function change(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined || from <= 0) return null;
  return to / from - 1;
}

export function confidenceScore(factors: ConfidenceFactors): number {
  // Moyenne géométrique pondérée : un facteur nul (relevé périmé) annule la confiance.
  const score =
    Math.pow(factors.history, 0.3) * Math.pow(factors.freshness, 0.3) * Math.pow(factors.volume, 0.2) * Math.pow(factors.stability, 0.2);
  return Math.round(100 * score);
}

/**
 * @param days relevés de l'objet, tous jours confondus (l'ordre importe peu)
 * @param today date du jour (AAAA-MM-JJ, fuseau du joueur)
 * @param historyFrom premier jour pris en compte (économie de la bêta exclue), ou null
 */
export function computeItemStats(
  itemKey: string,
  days: readonly DayObservation[],
  latest: LatestObservation | null,
  today: string,
  historyFrom: string | null,
): ItemStats {
  const usable = days.filter((d) => (historyFrom === null || d.day >= historyFrom) && d.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1));
  const within = (n: number) => usable.filter((d) => daysBetween(d.day, today) < n);
  const last30 = within(30);
  const last14 = within(14);
  const last7 = within(7);
  const lows30 = last30.map((d) => d.low);

  const lastObs = usable.at(-1) ?? null;
  const lastDay = lastObs?.day ?? null;
  const median30 = median(lows30);
  const median7 = median(last7.map((d) => d.low));

  let marketValue: number | null = null;
  let marketValueBasis: ItemStats["marketValueBasis"] = "insuffisant";
  if (last14.length >= MIN_DAYS_FOR_VALUE) {
    marketValue = median(last14.map((d) => d.low));
    marketValueBasis = "médiane 14 j";
  } else if (last30.length >= MIN_DAYS_FOR_VALUE) {
    marketValue = median30;
    marketValueBasis = "médiane 30 j";
  }

  const weighted = last30.filter((d) => d.available !== null && d.available > 0);
  const weightTotal = weighted.reduce((total, d) => total + d.available!, 0);
  const weightedMean30 =
    weightTotal > 0 ? weighted.reduce((total, d) => total + d.low * d.available!, 0) / weightTotal : lows30.length > 0 ? lows30.reduce((a, b) => a + b, 0) / lows30.length : null;

  const availabilities = last30.flatMap((d) => (d.available === null ? [] : [d.available]));
  const medianAvailable30 = median(availabilities);

  const lastLow = lastObs?.low ?? null;
  const before = (offset: number) => {
    if (!lastDay) return null;
    const target = usable.filter((d) => daysBetween(d.day, lastDay) >= offset);
    return target.at(-1)?.low ?? null;
  };

  const spread = mad(lows30);
  const volatility30 = lows30.length >= MIN_DAYS_FOR_VALUE && median30 && spread !== null ? (1.4826 * spread) / median30 : null;

  // Le dernier prix comparé aux jours qui le précèdent : un prix isolé ne fausse pas sa propre référence.
  const previous = last30.slice(0, -1).map((d) => d.low);
  const reference = median(previous);
  const previousSpread = mad(previous);
  const currentPrice = latest && (historyFrom === null || latest.day >= historyFrom) ? latest.minCopper : null;
  let outlierScore: number | null = null;
  if (currentPrice !== null && reference !== null && previous.length >= MIN_DAYS_FOR_VALUE) {
    // MAD nulle (prix figé) : l'écart relatif à la médiane, ramené à la même échelle.
    outlierScore = previousSpread ? Math.abs(currentPrice - reference) / (1.4826 * previousSpread) : Math.abs(currentPrice / reference - 1) * 7;
  }

  const ageDays = lastDay ? daysBetween(lastDay, today) : null;
  const factors: ConfidenceFactors = {
    history: clamp(last30.length / 7),
    freshness: ageDays === null ? 0 : ageDays <= 1 ? 1 : clamp(1 - (ageDays - 1) / 9),
    volume:
      medianAvailable30 === null ? 0.5 : medianAvailable30 <= 2 ? 0.15 : clamp(0.15 + (0.85 * Math.log(medianAvailable30 / 2)) / Math.log(10), 0.15, 1),
    stability: volatility30 === null ? 0.4 : volatility30 <= 0.15 ? 1 : clamp(1 - ((volatility30 - 0.15) / 0.85) * 0.8, 0.2, 1),
  };

  const thinMarket = medianAvailable30 !== null && medianAvailable30 <= 2;
  const liquidity: Liquidity =
    medianAvailable30 === null ? "inconnue" : medianAvailable30 >= 50 ? "élevée" : medianAvailable30 >= 10 ? "moyenne" : "faible";

  return {
    itemKey,
    current:
      currentPrice !== null && latest
        ? { minCopper: currentPrice, day: latest.day, ageDays: daysBetween(latest.day, today), at: latest.at ?? null, source: latest.source ?? "auctionator" }
        : null,
    lastDay,
    lastAvailable: lastObs?.available ?? null,
    daysObserved7: last7.length,
    daysObserved30: last30.length,
    median7,
    median30,
    weightedMean30,
    marketValue,
    marketValueBasis,
    medianAvailable30,
    change1d: usable.length >= 2 ? change(usable.at(-2)!.low, lastLow) : null,
    change7d: change(before(7), lastLow),
    change30d: change(before(30), lastLow),
    volatility30,
    liquidity,
    outlierScore,
    outlier: outlierScore !== null && outlierScore > OUTLIER_THRESHOLD,
    // 1 ou 2 objets en vente : un seul vendeur fixe le prix, la valeur n'est pas fiable.
    thinMarket,
    confidence:
      thinMarket || last30.length < MIN_DAYS_FOR_VALUE ? Math.min(THIN_MARKET_CONFIDENCE_CAP, confidenceScore(factors)) : confidenceScore(factors),
    confidenceFactors: factors,
  };
}
