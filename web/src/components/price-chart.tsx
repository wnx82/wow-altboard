"use client";

import { useId, useMemo, useState } from "react";
import { ChartAnnouncer, ChartGrid, ChartTooltip, tooltipHeight, useChartKeyboard, useChartWidth } from "@/components/chart-parts";
import { coinUnit, nearestIndex, niceTicks, tooltipLeft } from "@/lib/chart/scale";

/** Relevé d'un jour : prix en pièces de cuivre, libellés déjà formatés par la page. */
export type PricePoint = { day: string; low: number; high: number; dateLabel: string; lowLabel: string; highLabel: string; availableLabel: string };

type Props = { title: string; note: string; points: PricePoint[] };

const HEIGHT = 220;
const MARGIN = { top: 16, right: 74, bottom: 28, left: 58 };
const DAY_MS = 86_400_000;
const TOOLTIP_WIDTH = 196;
const tickNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/**
 * Prix d'un objet jour par jour : la courbe suit le plus bas du jour (prix de référence), la bande
 * l'écart entre le plus bas et le plus haut des prix minimums vus ce jour-là. Un seul axe, une seule
 * mesure. Un jour sans relevé n'est pas tracé : la courbe relie les jours relevés, les marques les
 * situent. Chaque valeur reste lisible sans survol (un arrêt de tabulation puis les flèches, tableau
 * sous le graphique).
 */
export function PriceChart({ title, note, points }: Props) {
  const titleId = useId();
  const [frame, width] = useChartWidth(640);
  const [active, setActive] = useState<number | null>(null);
  const keyboard = useChartKeyboard(points.length, active, setActive);

  const layout = useMemo(() => {
    const times = points.map((point) => Date.parse(`${point.day}T00:00:00Z`));
    const ticks = niceTicks(Math.min(...points.map((p) => p.low)), Math.max(...points.map((p) => p.high)), false).filter((tick) => tick >= 0);
    const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]];
    const [tMin, tMax] = [Math.min(...times), Math.max(times[times.length - 1], Math.min(...times) + DAY_MS)];
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + ((time - tMin) / (tMax - tMin)) * plotWidth;
    const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;
    const coordinates = points.map((point, index) => ({ x: x(times[index]), low: y(point.low), high: y(point.high) }));
    const band = [...coordinates.map((c) => `${c.x},${c.high}`), ...coordinates.toReversed().map((c) => `${c.x},${c.low}`)].join(" ");
    // Graduations dans l'unité de la plus grande : po, pa ou pc.
    const unit = coinUnit(yMax);
    return { ticks, y, coordinates, band, plotWidth, plotHeight, format: (copper: number) => `${tickNumber.format(copper / unit.size)}${unit.suffix}` };
  }, [points, width]);

  const { coordinates } = layout;
  const last = coordinates[coordinates.length - 1];
  const current = active === null ? null : { point: points[active], ...coordinates[active] };
  const tooltipLines = current ? [`Plus bas ${current.point.lowLabel}`, `Plus haut ${current.point.highLabel}`, current.point.availableLabel, current.point.dateLabel] : [];
  const boxHeight = tooltipHeight(4);
  const tooltipY = current ? (current.high > MARGIN.top + boxHeight + 8 ? current.high - boxHeight - 8 : current.low + 12) : 0;

  return (
    <figure className="panel p-4" data-series="gold">
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId} {...keyboard.svgProps}>
          <ChartGrid ticks={layout.ticks} y={layout.y} left={MARGIN.left} right={width - MARGIN.right} label={layout.format} />
          <text className="trend-axis" x={MARGIN.left} y={HEIGHT - 8} textAnchor="start">
            {points[0].dateLabel}
          </text>
          {points.length > 1 && (
            <text className="trend-axis" x={last.x} y={HEIGHT - 8} textAnchor="end">
              {points[points.length - 1].dateLabel}
            </text>
          )}

          <polygon className="price-band" points={layout.band} />
          {current && <line className="trend-crosshair" x1={current.x} x2={current.x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />}
          <polyline className="trend-line" points={coordinates.map((c) => `${c.x},${c.low}`).join(" ")} />
          {coordinates.map((coordinate, index) => (
            <circle
              key={points[index].day}
              className="trend-marker"
              cx={coordinate.x}
              cy={coordinate.low}
              r={active === index ? 5.5 : points.length > 45 ? 2.5 : 4}
              data-active={active === index || undefined}
            />
          ))}
          <text className="trend-value" x={last.x + 10} y={last.low} dominantBaseline="middle">
            {points[points.length - 1].lowLabel}
          </text>

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(layout.plotWidth, 0)}
            height={layout.plotHeight}
            fill="transparent"
            onPointerMove={(event) =>
              setActive(nearestIndex(coordinates.map((c) => c.x), event.clientX - event.currentTarget.getBoundingClientRect().left + MARGIN.left))
            }
            onPointerLeave={() => setActive(null)}
          />

          {current && <ChartTooltip x={tooltipLeft(current.x, TOOLTIP_WIDTH, width)} y={tooltipY} width={TOOLTIP_WIDTH} lines={tooltipLines} />}
        </svg>
      </div>
      <ChartAnnouncer
        hintId={keyboard.hintId}
        text={current ? `${current.point.dateLabel} : plus bas ${current.point.lowLabel}, plus haut ${current.point.highLabel}, ${current.point.availableLabel}` : null}
      />
    </figure>
  );
}
