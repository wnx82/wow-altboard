import { ColumnChart, type Column } from "@/components/column-chart";
import { type LevelTime } from "@/lib/dashboard/level-times";
import { sessionTagLabel, type Session } from "@/lib/dashboard/sessions";
import { formatDateTime, formatDuration, formatInteger, PLAYER_TIME_ZONE } from "@/lib/wow/format";

// Graphiques des données de l'addon Allemano Ledger. Les libellés sont préparés ici, côté serveur :
// le composant de tracé ne reçoit que du texte.

/** Temps de jeu par niveau : une colonne par niveau, le niveau en cours atténué. */
export function LevelTimeChart({ levels }: { levels: LevelTime[] }) {
  const columns: Column[] = levels.map((entry) => ({
    key: entry.level,
    axisLabel: String(entry.level),
    value: entry.playedSeconds,
    valueLabel: formatDuration(entry.playedSeconds),
    partial: entry.current,
    ariaLabel: `Niveau ${entry.level}${entry.current ? " en cours" : ""} : ${entry.playedSeconds === null ? "temps de jeu non mesuré" : formatDuration(entry.playedSeconds)}`,
    tooltip: [
      entry.current ? `Niveau ${entry.level} (en cours)` : `Niveau ${entry.level} → ${entry.level + 1}`,
      entry.playedSeconds === null ? "Temps de jeu non mesuré" : `Temps de jeu : ${formatDuration(entry.playedSeconds)}`,
      ...(entry.wallSeconds === null ? [] : [`Temps réel : ${formatDuration(entry.wallSeconds)}`]),
      ...(entry.reachedAt === null ? [] : [`Terminé le ${formatDateTime(entry.reachedAt)}`]),
      ...(entry.zone === null ? [] : [entry.zone]),
    ],
  }));
  return (
    <ColumnChart
      title="Temps de jeu par niveau"
      note="Temps /played passé sur chaque niveau. Colonne claire : niveau en cours."
      series="level"
      scale="duration"
      columns={columns}
    />
  );
}

/** Sessions tracées : au-delà, les colonnes deviennent illisibles sur un écran étroit. */
export const SESSIONS_CHARTED = 30;
const day = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", timeZone: PLAYER_TIME_ZONE });

/** Expérience gagnée par session : une colonne par session, la session en cours atténuée. */
export function SessionXpChart({ sessions }: { sessions: Session[] }) {
  const columns: Column[] = sessions.slice(-SESSIONS_CHARTED).map((session) => {
    const tag = sessionTagLabel(session.tag);
    return {
      key: session.startedAt,
      axisLabel: day.format(new Date(session.startedAt)),
      value: session.xpGained,
      valueLabel: formatInteger(session.xpGained),
      partial: session.current,
      ariaLabel: `Session du ${formatDateTime(session.startedAt)}${session.current ? " en cours" : ""} : ${session.xpGained === null ? "expérience non mesurée" : `${formatInteger(session.xpGained)} XP`}`,
      tooltip: [
        `${formatDateTime(session.startedAt)}${session.current ? " (en cours)" : ""}`,
        session.xpGained === null ? "Expérience non mesurée" : `XP gagnée : ${formatInteger(session.xpGained)}`,
        ...(session.durationSeconds === null ? [] : [`Durée : ${formatDuration(session.durationSeconds)}`]),
        ...(session.xpPerHour === null ? [] : [`XP par heure : ${formatInteger(session.xpPerHour)}`]),
        ...(session.levels ? [`Niveaux gagnés : ${session.levels}`] : []),
        ...(session.zone === null ? [] : [session.zone]),
        ...(tag === null ? [] : [tag]),
      ],
    };
  });
  return (
    <ColumnChart
      title="Expérience par session"
      note={`XP gagnée pendant chaque session${sessions.length > SESSIONS_CHARTED ? ` (les ${SESSIONS_CHARTED} dernières)` : ""}. Colonne claire : session en cours.`}
      series="xp"
      scale="count"
      columns={columns}
    />
  );
}
