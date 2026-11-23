import { ColumnChart, type Column } from "@/components/column-chart";
import { LevelsChart, type LevelsChartSeries } from "@/components/levels-chart";
import { dayTicks, type LevelProgress } from "@/lib/dashboard/levels";
import { PLAYER_TIME_ZONE } from "@/lib/wow/format";

// Graphiques de l'évolution des niveaux, tous personnages confondus. Les libellés sont préparés
// ici, côté serveur : les composants de tracé ne reçoivent que du texte.

const HOUR = 3600 * 1000;
const levelFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const pointDate = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: PLAYER_TIME_ZONE });
const tickDay = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", timeZone: PLAYER_TIME_ZONE });
const tickMonth = new Intl.DateTimeFormat("fr-BE", { month: "short", year: "2-digit", timeZone: PLAYER_TIME_ZONE });

/** Courbe de chaque personnage en progression sur la période ; null si aucun n'a progressé. */
export function LevelProgressChart({ progress }: { progress: LevelProgress }) {
  const charted = progress.series.filter((entry) => entry.progressed);
  if (charted.length === 0) return null;

  const series: LevelsChartSeries[] = charted.map((entry) => ({
    id: entry.id,
    name: entry.name,
    endLabel: levelFormat.format(entry.points.at(-1)!.value),
    summary: entry.gained > 0 ? `${entry.startLevel} → ${entry.endLevel}` : String(entry.endLevel),
    points: entry.points.map((point) => ({
      at: point.at.toISOString(),
      value: point.value,
      // La part reste sous 100 % : un niveau n'est franchi que par le jeu.
      label: point.percent === null ? `Niveau ${point.level}` : `Niveau ${point.level} · ${Math.min(point.percent, 99)} %`,
      dateLabel: point.carried ? `Avant la période · ${pointDate.format(point.observedAt)}` : pointDate.format(point.observedAt),
    })),
  }));
  // Au-delà d'un an, le jour ne dit plus rien : le mois et l'année.
  const tickLabel = progress.to.getTime() - progress.from.getTime() > 366 * 24 * HOUR ? tickMonth : tickDay;

  return (
    <LevelsChart
      title="Évolution des niveaux"
      note="Niveau et expérience acquise. En couleur : le personnage désigné, par le pointeur ou dans la légende."
      series={series}
      from={progress.from.toISOString()}
      to={progress.to.toISOString()}
      // Libellé pris en cours de journée : le jour d'un changement d'heure, la graduation tombe à une heure près.
      ticks={dayTicks(progress.from, progress.to).map((tick) => ({ at: tick.toISOString(), label: tickLabel.format(new Date(tick.getTime() + 6 * HOUR)) }))}
    />
  );
}

/** Lignes de détail d'une infobulle : au-delà, « … et n autres ». */
const DETAILS_SHOWN = 5;
// Les tranches sont des jours civils, portés à midi UTC : aucun fuseau ne les fait changer de date.
const civil = { timeZone: "UTC" } as const;
const longDay = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long", ...civil });
const shortDay = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", ...civil });
const longMonth = new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric", ...civil });
const shortMonth = new Intl.DateTimeFormat("fr-BE", { month: "short", year: "2-digit", ...civil });
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const gainLabel = (gained: number) => (gained === 0 ? "Aucun niveau gagné" : `${gained} niveau${gained > 1 ? "x" : ""} gagné${gained > 1 ? "s" : ""}`);

const UNITS = {
  day: { label: "jour", title: (start: Date) => capitalize(longDay.format(start)), axis: (start: Date) => shortDay.format(start) },
  week: { label: "semaine", title: (start: Date) => `Semaine du ${shortDay.format(start)}`, axis: (start: Date) => shortDay.format(start) },
  month: { label: "mois", title: (start: Date) => capitalize(longMonth.format(start)), axis: (start: Date) => shortMonth.format(start) },
};

/** Niveaux gagnés par jour, par semaine ou par mois selon la longueur de la période ; la tranche en cours atténuée. */
export function LevelGainsChart({ progress }: { progress: LevelProgress }) {
  const unit = UNITS[progress.unit];
  const columns: Column[] = progress.buckets.map((bucket, index) => {
    const title = unit.title(new Date(`${bucket.start}T12:00:00Z`));
    const details = bucket.details.toSorted((a, b) => b.to - b.from - (a.to - a.from) || a.name.localeCompare(b.name, "fr"));
    const hidden = details.length - DETAILS_SHOWN;
    return {
      key: bucket.start,
      axisLabel: unit.axis(new Date(`${bucket.start}T12:00:00Z`)),
      value: bucket.gained,
      // Rien au-dessus d'une tranche vide : un zéro par colonne ne se lirait pas.
      valueLabel: bucket.gained === 0 ? "" : String(bucket.gained),
      partial: index === progress.buckets.length - 1,
      ariaLabel: `${title} : ${gainLabel(bucket.gained).toLowerCase()}`,
      tooltip: [
        title,
        gainLabel(bucket.gained),
        ...details.slice(0, DETAILS_SHOWN).map((detail) => `${detail.name} : ${detail.from} → ${detail.to}`),
        ...(hidden > 0 ? [`… et ${hidden} autre${hidden > 1 ? "s" : ""}`] : []),
      ],
    };
  });
  return (
    <ColumnChart
      title={`Niveaux gagnés par ${unit.label}`}
      note="Tous personnages confondus, à la date du relevé qui montre le niveau. Colonne claire : en cours."
      series="level"
      scale="count"
      columns={columns}
    />
  );
}
