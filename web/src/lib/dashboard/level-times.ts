// Temps de jeu par niveau, tel que relevé par l'addon Allemano Ledger.

export type LevelTime = {
  level: number;
  /** Temps de jeu (/played) passé sur ce niveau ; null s'il n'a pas pu être mesuré. */
  playedSeconds: number | null;
  /** Temps réel écoulé entre le début et la fin du niveau. */
  wallSeconds: number | null;
  /** Instant où le niveau a été terminé (ISO), absent pour le niveau en cours. */
  reachedAt: string | null;
  zone: string | null;
  /** Niveau en cours : durée mesurée jusqu'au dernier relevé, donc encore partielle. */
  current: boolean;
};

type LevelRow = { level: number; playedSeconds: number | null; wallSeconds: number | null; reachedAt: Date | null; zone: string | null };
type Playtime = {
  totalSeconds: number | null;
  measuredAt: Date | null;
  currentLevel: number | null;
  currentLevelStartSeconds: number | null;
  currentLevelStartedAt: Date | null;
} | null;

/**
 * Niveaux terminés, dans l'ordre, suivis du niveau en cours quand son début est connu.
 * Le niveau en cours n'est retenu que s'il correspond au niveau du personnage : sinon le relevé
 * de temps de jeu est antérieur à un passage de niveau et ne décrit plus rien d'actuel.
 */
export function buildLevelTimes(rows: LevelRow[], playtime: Playtime, characterLevel: number | null): LevelTime[] {
  const finished: LevelTime[] = [...rows]
    .sort((a, b) => a.level - b.level)
    .map((row) => ({
      level: row.level,
      playedSeconds: row.playedSeconds,
      wallSeconds: row.wallSeconds,
      reachedAt: row.reachedAt?.toISOString() ?? null,
      zone: row.zone,
      current: false,
    }));

  if (
    !playtime ||
    playtime.currentLevel === null ||
    playtime.totalSeconds === null ||
    playtime.currentLevelStartSeconds === null ||
    (characterLevel !== null && playtime.currentLevel !== characterLevel) ||
    finished.some((entry) => entry.level === playtime.currentLevel)
  ) {
    return finished;
  }

  return [
    ...finished,
    {
      level: playtime.currentLevel,
      playedSeconds: Math.max(0, playtime.totalSeconds - playtime.currentLevelStartSeconds),
      wallSeconds:
        playtime.measuredAt && playtime.currentLevelStartedAt
          ? Math.max(0, Math.round((playtime.measuredAt.getTime() - playtime.currentLevelStartedAt.getTime()) / 1000))
          : null,
      reachedAt: null,
      zone: null,
      current: true,
    },
  ];
}

/** Au-delà, le niveau lu est aberrant : la liste n'est pas complétée (même borne que l'agent). */
const LEVELS_FILLED_MAX = 200;

/**
 * Tous les niveaux, du premier à celui du personnage : ceux que l'addon n'a pas relevés apparaissent
 * sans durée ni date. Sans aucun relevé, la liste reste vide : il n'y a rien à compléter.
 */
export function fillLevelTimes(levels: LevelTime[], characterLevel: number | null): LevelTime[] {
  if (levels.length === 0) return levels;
  const known = new Map(levels.map((entry) => [entry.level, entry]));
  const first = Math.min(1, ...known.keys());
  const last = Math.max(characterLevel ?? 0, ...known.keys());
  if (last > LEVELS_FILLED_MAX) return levels;

  return Array.from({ length: last - first + 1 }, (_, index) => {
    const level = first + index;
    return (
      known.get(level) ?? {
        level,
        playedSeconds: null,
        wallSeconds: null,
        reachedAt: null,
        zone: null,
        // En cours seulement s'il clôt la liste : aucun niveau terminé ne le suit.
        current: level === characterLevel && level === last,
      }
    );
  });
}

/**
 * Temps de jeu cumulé à la fin de chaque niveau, c'est-à-dire le /played total à cet instant ; pour
 * le niveau en cours, le total du dernier relevé. Calculé en remontant depuis ce total et, à défaut,
 * en additionnant depuis le niveau 1. Un niveau sans temps mesuré n'a pas de cumul et interrompt le
 * calcul : rien n'est estimé.
 */
export function cumulativePlayedSeconds(levels: LevelTime[], totalSeconds: number | null): Map<number, number> {
  const cumulative = new Map<number, number>();
  const follows = (index: number) => levels[index].level === levels[index - 1].level + 1;
  const last = levels.length - 1;

  if (totalSeconds !== null && levels[last]?.current) {
    let running = totalSeconds;
    for (let index = last; index >= 0; index--) {
      const played = levels[index].playedSeconds;
      if (played === null || running < 0 || (index < last && !follows(index + 1))) break;
      cumulative.set(levels[index].level, running);
      running -= played;
    }
  }

  if (levels[0]?.level === 1) {
    let running = 0;
    for (let index = 0; index < levels.length; index++) {
      const played = levels[index].playedSeconds;
      if (played === null || (index > 0 && !follows(index))) break;
      running += played;
      if (!cumulative.has(levels[index].level)) cumulative.set(levels[index].level, running);
    }
  }

  return cumulative;
}
