import { brusselsDay, fractionalLevel, PLAYER_TIME_ZONE, progressPercent } from "@/lib/wow/format";

// Évolution des niveaux de tous les personnages sur une période, lue dans leurs relevés. Un niveau
// gagné porte la date du relevé qui le montre, pas celle où il s'est produit en jeu.

export type LevelRow = {
  characterId: number;
  name: string;
  class: string | null;
  account: string;
  capturedAt: Date;
  level: number;
  xp: number | null;
  xpMax: number | null;
};

export type LevelPoint = {
  /** Position sur l'axe du temps. */
  at: Date;
  /** Instant du relevé ; antérieur à `at` pour un point reporté. */
  observedAt: Date;
  /** Niveau et part d'expérience acquise sur une même échelle (voir fractionalLevel). */
  value: number;
  level: number;
  /** Part du niveau acquise, en pour cent ; null sans expérience connue. */
  percent: number | null;
  /** Dernier relevé d'avant la période, reporté à son début : le point de départ de la courbe. */
  carried: boolean;
};

export type LevelSeries = {
  id: number;
  name: string;
  class: string | null;
  account: string;
  /** Du plus ancien au plus récent. */
  points: LevelPoint[];
  startLevel: number;
  endLevel: number;
  /** Niveaux gagnés sur la période. */
  gained: number;
  /** Niveau ou expérience en hausse sur la période : la courbe n'est pas plate. */
  progressed: boolean;
  lastLevelUpAt: Date | null;
};

export type BucketUnit = "day" | "week" | "month";

export type LevelBucket = {
  /** Premier jour de la tranche (AAAA-MM-JJ, heure de Bruxelles). */
  start: string;
  gained: number;
  /** Par personnage : son niveau avant la tranche et celui qu'il y atteint. */
  details: { id: number; name: string; from: number; to: number }[];
};

export type LevelProgress = {
  from: Date;
  to: Date;
  unit: BucketUnit;
  /** Du plus grand gain de niveaux au plus petit. */
  series: LevelSeries[];
  /** Toutes les tranches de la période, vides comprises. */
  buckets: LevelBucket[];
  totalGained: number;
};

const DAY = 24 * 3600 * 1000;

// Un jour civil (AAAA-MM-JJ) est manipulé comme l'instant UTC de même date : l'arithmétique des
// jours ignore ainsi le fuseau et l'heure d'été.
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);

function bucketStart(day: string, unit: BucketUnit): string {
  if (unit === "day") return day;
  if (unit === "month") return `${day.slice(0, 7)}-01`;
  const time = toUtc(day);
  // Lundi de la semaine : getUTCDay vaut 0 le dimanche.
  return fromUtc(time - ((new Date(time).getUTCDay() + 6) % 7) * DAY);
}

function nextBucket(start: string, unit: BucketUnit): string {
  if (unit !== "month") return fromUtc(toUtc(start) + (unit === "week" ? 7 : 1) * DAY);
  const [year, month] = start.split("-").map(Number);
  // `month` compte à partir de 1 : pris comme indice, il désigne déjà le mois suivant.
  return fromUtc(Date.UTC(year, month, 1));
}

/**
 * Courbes et gains de niveaux depuis `since` (null : depuis le premier relevé). Les relevés
 * antérieurs à `since` ne servent que de point de départ : le dernier de chaque personnage.
 */
export function buildLevelProgress(rows: LevelRow[], since: Date | null, now: Date): LevelProgress {
  const from = since ?? rows.reduce((earliest, row) => (row.capturedAt < earliest ? row.capturedAt : earliest), now);
  // L'horloge d'un PC peut avancer : un relevé daté après `now` reste dans la période.
  const to = rows.reduce((latest, row) => (row.capturedAt > latest ? row.capturedAt : latest), now);
  const days = (to.getTime() - from.getTime()) / DAY;
  const unit: BucketUnit = days <= 31 ? "day" : days <= 183 ? "week" : "month";

  const buckets = new Map<string, LevelBucket>();
  const last = bucketStart(brusselsDay(to), unit);
  for (let start = bucketStart(brusselsDay(from), unit); start <= last; start = nextBucket(start, unit)) {
    buckets.set(start, { start, gained: 0, details: [] });
  }

  const series: LevelSeries[] = [];
  for (const group of Map.groupBy(rows, (row) => row.characterId).values()) {
    const ordered = group.toSorted((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    const before = ordered.findLast((row) => row.capturedAt < from) ?? null;
    const inside = ordered.filter((row) => row.capturedAt >= from);
    const first = before ?? inside[0];

    let level = first.level;
    let gained = 0;
    let lastLevelUpAt: Date | null = null;
    for (const row of inside) {
      if (row.level > level) {
        const bucket = buckets.get(bucketStart(brusselsDay(row.capturedAt), unit))!;
        const detail = bucket.details.find((entry) => entry.id === row.characterId);
        if (detail) detail.to = row.level;
        else bucket.details.push({ id: row.characterId, name: row.name, from: level, to: row.level });
        bucket.gained += row.level - level;
        gained += row.level - level;
        lastLevelUpAt = row.capturedAt;
      }
      // Niveau en baisse : personnage supprimé puis recréé sous le même nom. Le compte repart de là.
      level = row.level;
    }

    // Sur une longue période, un point par jour suffit à la courbe : le dernier relevé du jour.
    const kept = unit === "day" ? inside : [...Map.groupBy(inside, (row) => brusselsDay(row.capturedAt)).values()].map((sameDay) => sameDay.at(-1)!);
    const toPoint = (row: LevelRow, carried: boolean): LevelPoint => ({
      at: carried ? from : row.capturedAt,
      observedAt: row.capturedAt,
      value: fractionalLevel(row.level, row.xp, row.xpMax),
      level: row.level,
      percent: progressPercent(row.xp, row.xpMax),
      carried,
    });
    const points = [...(before ? [toPoint(before, true)] : []), ...kept.map((row) => toPoint(row, false))];

    series.push({
      id: first.characterId,
      name: first.name,
      class: first.class,
      account: first.account,
      points,
      startLevel: first.level,
      endLevel: level,
      gained,
      progressed: gained > 0 || points.at(-1)!.value > points[0].value,
      lastLevelUpAt,
    });
  }

  series.sort(
    (a, b) =>
      b.gained - a.gained ||
      b.points.at(-1)!.value - b.points[0].value - (a.points.at(-1)!.value - a.points[0].value) ||
      b.endLevel - a.endLevel ||
      a.name.localeCompare(b.name, "fr"),
  );

  return { from, to, unit, series, buckets: [...buckets.values()], totalGained: series.reduce((total, entry) => total + entry.gained, 0) };
}

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: PLAYER_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Minuit, heure de Bruxelles, du jour de `date` ; à une heure près le jour d'un changement d'heure. */
function startOfDay(date: Date): Date {
  const [hours, minutes, seconds] = clock.format(date).split(":").map(Number);
  return new Date(Math.floor(date.getTime() / 1000) * 1000 - ((hours * 60 + minutes) * 60 + seconds) * 1000);
}

/** Graduations de l'axe du temps : des débuts de journée espacés d'un nombre rond de jours, `max` au plus. */
export function dayTicks(from: Date, to: Date, max = 8): Date[] {
  const days = (to.getTime() - from.getTime()) / DAY;
  const step = [1, 2, 7, 14, 28, 56, 91, 182, 365].find((candidate) => days / candidate <= max) ?? Math.ceil(days / max);
  const ticks: Date[] = [];
  // Premier début de journée à partir de `from` ; ensuite, viser le milieu du jour voulu absorbe
  // l'heure gagnée ou perdue au changement d'heure.
  for (let tick = startOfDay(new Date(from.getTime() + DAY - 1)); tick <= to; tick = startOfDay(new Date(tick.getTime() + step * DAY + DAY / 2))) {
    ticks.push(tick);
  }
  return ticks;
}
