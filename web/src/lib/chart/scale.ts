// Calculs communs aux graphiques SVG : graduations, unité monétaire, placement de l'infobulle,
// étiquettes de l'axe et navigation au clavier. Purs, sans React : testés sans navigateur.

/** Pas « rond » (1, 2, 2,5, 5 ou 10 fois une puissance de dix) qui découpe une étendue en `parts` pas environ. */
export function niceStep(range: number, parts: number): number {
  if (!(range > 0)) return 1;
  const rough = range / parts;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
}

/** Graduations « rondes » couvrant [min, max], jamais plus serrées que minStep. */
export function niceTicks(min: number, max: number, integer: boolean, minStep = 0): number[] {
  if (min === max) {
    if (integer) return [min - 1, min, min + 1];
    return min === 0 ? [0, 1] : [min * 0.9, min, min * 1.1];
  }
  let step = niceStep(max - min, 3);
  if (integer) step = Math.max(1, Math.round(step));
  step = Math.max(step, minStep);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick < max + step; tick += step) ticks.push(Number(tick.toFixed(10)));
  return ticks;
}

/** Graduations de 0 à un maximum « rond », en trois ou quatre pas. */
export function ticksUpTo(max: number, integer: boolean): number[] {
  if (max <= 0) return [0, 1];
  let step = niceStep(max, 3);
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) ticks.push(Number(tick.toFixed(6)));
  return ticks;
}

export type CoinUnit = { size: number; suffix: string };

/** La plus grande pièce qu'atteint un montant en cuivre : po, pa ou pc. */
export function coinUnit(highestCopper: number): CoinUnit {
  if (highestCopper >= 10_000) return { size: 10_000, suffix: " po" };
  if (highestCopper >= 100) return { size: 100, suffix: " pa" };
  return { size: 1, suffix: " pc" };
}

/** Bord gauche d'une infobulle centrée sur `center`, gardée à 4 px des bords du graphique. */
export function tooltipLeft(center: number, tooltipWidth: number, chartWidth: number): number {
  return Math.min(Math.max(center - tooltipWidth / 2, 4), chartWidth - tooltipWidth - 4);
}

/** Une étiquette d'axe toutes les k colonnes quand elles se resserrent : la place dépend de leur longueur. */
export function labelEvery(labels: string[], band: number): number {
  const labelWidth = 12 + 7 * Math.max(0, ...labels.map((label) => label.length));
  return Math.max(1, Math.ceil(labelWidth / band));
}

/** La dernière colonne est toujours étiquetée ; une étiquette trop proche d'elle est omise. */
export function isLabelled(index: number, count: number, every: number): boolean {
  const last = count - 1;
  return index === last || (index % every === 0 && last - index >= every);
}

/** Indice de l'abscisse la plus proche de x. */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  xs.forEach((candidate, index) => {
    if (Math.abs(candidate - x) < Math.abs(xs[best] - x)) best = index;
  });
  return best;
}

/**
 * Valeur désignée après une touche, sur un graphique de `count` valeurs : flèches pour la voisine,
 * Début et Fin pour les extrémités, Échap pour n'en désigner aucune. undefined : touche sans effet
 * sur le graphique, laissée au navigateur.
 */
export function stepIndex(key: string, current: number | null, count: number): number | null | undefined {
  if (count === 0) return undefined;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return current === null ? last : Math.min(current + 1, last);
    case "ArrowLeft":
    case "ArrowDown":
      return current === null ? last : Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    case "Escape":
      return null;
    default:
      return undefined;
  }
}
