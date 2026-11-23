"use client";

import { useId, useMemo, useState } from "react";
import { ChartAnnouncer, ChartGrid, ChartTooltip, tooltipHeight, useChartKeyboard, useChartWidth } from "@/components/chart-parts";
import { niceTicks, tooltipLeft } from "@/lib/chart/scale";

export type LevelsChartSeries = {
  id: number;
  name: string;
  /** Posé au bout de la courbe mise en avant : le niveau atteint. */
  endLabel: string;
  /** Résumé de la période, lu dans la légende : « 28 → 34 ». */
  summary: string;
  points: { at: string; value: number; label: string; dateLabel: string }[];
};

type Props = {
  title: string;
  note: string;
  /** Au moins une série ; la première est mise en avant à l'ouverture. */
  series: LevelsChartSeries[];
  /** Bornes de l'axe du temps (ISO). */
  from: string;
  to: string;
  ticks: { at: string; label: string }[];
};

type Coordinate = { x: number; y: number };

const HEIGHT = 300;
const MARGIN = { top: 16, bottom: 30, left: 46 };
/** Au-delà, une marque par relevé noierait la courbe : seuls son bout et le point survolé sont marqués. */
const MAX_MARKERS = 45;
const TOOLTIP_WIDTH = 188;

/** Distance du point (px, py) au segment [a, b]. */
function segmentDistance(px: number, py: number, a: Coordinate, b: Coordinate): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length));
  return Math.hypot(px - (a.x + along * dx), py - (a.y + along * dy));
}

/**
 * Courbes de plusieurs personnages sur un même axe : une seule est en couleur, les autres restent
 * en contexte. Le pointeur met en avant la courbe la plus proche, la légende en choisit une au
 * clic ou au clavier ; sur le graphique, les flèches parcourent les relevés de la courbe mise en
 * avant. Chaque valeur reste accessible sans survol, dans le tableau qui accompagne le graphique.
 */
export function LevelsChart({ title, note, series, from, to, ticks }: Props) {
  const titleId = useId();
  const [frame, width] = useChartWidth(960);
  const [selected, setSelected] = useState(series[0].id);
  // index null : courbe désignée par la légende, sans point survolé.
  const [hover, setHover] = useState<{ id: number; index: number | null } | null>(null);

  // Sur un écran étroit, le nom au bout de la courbe prendrait la place du tracé : la légende suffit.
  const labelled = width >= 560;
  const marginRight = labelled ? Math.min(180, 20 + 7 * Math.max(...series.map((entry) => entry.name.length + entry.endLabel.length + 3))) : 16;

  const layout = useMemo(() => {
    const values = series.flatMap((entry) => entry.points.map((point) => point.value));
    const levelTicks = niceTicks(Math.min(...values), Math.max(...values), true);
    const [yMin, yMax] = [levelTicks[0], levelTicks[levelTicks.length - 1]];
    const [tMin, tMax] = [Date.parse(from), Date.parse(to)];
    const plotWidth = Math.max(width - MARGIN.left - marginRight, 1);
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + (tMax === tMin ? plotWidth / 2 : ((time - tMin) / (tMax - tMin)) * plotWidth);
    const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
    const lines = series.map((entry) => ({
      entry,
      coordinates: entry.points.map((point): Coordinate => ({ x: x(Date.parse(point.at)), y: y(point.value) })),
    }));
    // Une graduation de temps toutes les k quand elles se resserrent.
    const every = Math.max(1, Math.ceil((ticks.length * 52) / plotWidth));
    const timeTicks = ticks.filter((_, index) => index % every === 0).map((tick) => ({ label: tick.label, x: x(Date.parse(tick.at)) }));
    return { levelTicks, timeTicks, lines, y, plotWidth, plotHeight };
  }, [series, from, to, ticks, width, marginRight]);

  const active = layout.lines.find((line) => line.entry.id === (hover?.id ?? selected)) ?? layout.lines[0];
  const pointIndex = hover?.id === active.entry.id && hover.index !== null && hover.index < active.coordinates.length ? hover.index : null;
  const current = pointIndex === null ? null : { point: active.entry.points[pointIndex], ...active.coordinates[pointIndex] };
  const end = active.coordinates[active.coordinates.length - 1];
  const baseline = HEIGHT - MARGIN.bottom;
  const keyboard = useChartKeyboard(active.coordinates.length, pointIndex, (index) => setHover(index === null ? null : { id: active.entry.id, index }));

  // La courbe la plus proche du pointeur, puis son relevé le plus proche : personne ne vise un trait de 2 px.
  const locate = (clientX: number, clientY: number, target: SVGRectElement) => {
    const box = target.getBoundingClientRect();
    const [px, py] = [clientX - box.left + MARGIN.left, clientY - box.top + MARGIN.top];
    let best: { id: number; index: number; distance: number } | null = null;
    for (const line of layout.lines) {
      for (let index = 0; index < line.coordinates.length; index++) {
        const coordinate = line.coordinates[index];
        const previous = line.coordinates[index - 1] ?? coordinate;
        const distance = segmentDistance(px, py, previous, coordinate);
        if (best !== null && distance >= best.distance) continue;
        const nearer = index > 0 && Math.abs(previous.x - px) < Math.abs(coordinate.x - px) ? index - 1 : index;
        best = { id: line.entry.id, index: nearer, distance };
      }
    }
    return best;
  };

  const tooltipY = current ? (current.y > MARGIN.top + 72 ? current.y - tooltipHeight(3) - 12 : current.y + 14) : 0;

  return (
    <figure className="panel p-4" data-series="level">
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId} {...keyboard.svgProps}>
          <ChartGrid ticks={layout.levelTicks} y={layout.y} left={MARGIN.left} right={width - marginRight} label={String} />
          <line className="trend-baseline" x1={MARGIN.left} x2={width - marginRight} y1={baseline} y2={baseline} />
          {layout.timeTicks.map((tick) => (
            <g key={tick.x}>
              <line className="trend-baseline" x1={tick.x} x2={tick.x} y1={baseline} y2={baseline + 4} />
              <text className="trend-axis" x={tick.x} y={HEIGHT - 8} textAnchor="middle">
                {tick.label}
              </text>
            </g>
          ))}

          {current && <line className="trend-crosshair" x1={current.x} x2={current.x} y1={MARGIN.top} y2={baseline} />}
          <g aria-hidden="true">
            {layout.lines
              .filter((line) => line !== active)
              .map((line) => (
                <polyline key={line.entry.id} className="levels-line" points={line.coordinates.map((c) => `${c.x},${c.y}`).join(" ")} />
              ))}
            {/* La courbe mise en avant est tracée en dernier : au-dessus des autres. */}
            <polyline className="levels-line" data-active points={active.coordinates.map((c) => `${c.x},${c.y}`).join(" ")} />
            {active.coordinates.map((coordinate, index) => {
              const last = index === active.coordinates.length - 1;
              if (!last && index !== pointIndex && active.coordinates.length > MAX_MARKERS) return null;
              return (
                <circle
                  key={active.entry.points[index].at}
                  className="trend-marker"
                  cx={coordinate.x}
                  cy={coordinate.y}
                  r={index === pointIndex ? 5.5 : 4}
                  data-active={index === pointIndex || undefined}
                />
              );
            })}
            {labelled && (
              <text className="levels-label" x={end.x + 10} y={end.y} dominantBaseline="middle">
                {active.entry.name} · {active.entry.endLabel}
              </text>
            )}
          </g>

          {/* Zone de survol : tout le tracé. Un clic garde la courbe désignée. */}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={layout.plotWidth}
            height={layout.plotHeight}
            fill="transparent"
            onPointerMove={(event) => setHover(locate(event.clientX, event.clientY, event.currentTarget))}
            onPointerLeave={() => setHover(null)}
            onClick={(event) => {
              const found = locate(event.clientX, event.clientY, event.currentTarget);
              if (found) setSelected(found.id);
            }}
          />

          {current && (
            <ChartTooltip x={tooltipLeft(current.x, TOOLTIP_WIDTH, width)} y={tooltipY} width={TOOLTIP_WIDTH} lines={[current.point.label, active.entry.name, current.point.dateLabel]} />
          )}
        </svg>
      </div>
      <ChartAnnouncer hintId={keyboard.hintId} text={current ? `${active.entry.name}, ${current.point.dateLabel} : ${current.point.label}` : null} />
      {series.length > 1 && (
        <ul className="levels-legend" aria-label="Personnages tracés">
          {series.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="levels-key"
                aria-pressed={entry.id === selected}
                data-active={entry.id === active.entry.id || undefined}
                onClick={() => setSelected(entry.id)}
                onPointerEnter={() => setHover({ id: entry.id, index: null })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ id: entry.id, index: null })}
                onBlur={() => setHover(null)}
              >
                {entry.name}
                <span className="tabular-nums text-faint">{entry.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
