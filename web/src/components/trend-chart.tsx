"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/** valueLabel : valeur courte posée au bout de la courbe ; à défaut, la valeur au format des graduations. */
export type TrendPoint = { at: string; value: number; label: string; dateLabel: string; valueLabel?: string };

type Props = {
  title: string;
  points: TrendPoint[];
  /** La série fixe la couleur (feuille de style), l'unité et le pas des graduations. */
  series: "level" | "gold";
};

const goldFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
// Pièces d'or au cuivre près, pour des prix qui ne varient que de quelques cuivres.
const goldFineFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const TICK_FORMAT: Record<Props["series"], (value: number, step: number) => string> = {
  level: (value) => String(Math.round(value)),
  gold: (value, step) => `${(step < 0.01 ? goldFineFormat : goldFormat).format(value)} po`,
};
/** Plus petit pas des graduations : un cuivre pour l'or, exprimé en pièces d'or. */
const MIN_STEP: Record<Props["series"], number> = { level: 0, gold: 0.0001 };

const HEIGHT = 200;
const MARGIN = { top: 16, right: 64, bottom: 28, left: 46 };

/** Graduations « rondes » couvrant [min, max], jamais plus serrées que minStep. */
export function niceTicks(min: number, max: number, integer: boolean, minStep = 0): number[] {
  if (min === max) {
    if (integer) return [min - 1, min, min + 1];
    return min === 0 ? [0, 1] : [min * 0.9, min, min * 1.1];
  }
  const rough = (max - min) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  if (integer) step = Math.max(1, Math.round(step));
  step = Math.max(step, minStep);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick < max + step; tick += step) ticks.push(Number(tick.toFixed(10)));
  return ticks;
}

/**
 * Courbe d'une seule série dans le temps. Une mesure par graphique, un seul axe. Chaque valeur
 * reste accessible sans survol : au clavier (points focalisables) et dans le tableau de
 * l'historique affiché sous les courbes.
 */
export function TrendChart({ title, points, series }: Props) {
  const integer = series === "level";
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const times = points.map((point) => Date.parse(point.at));
    const values = points.map((point) => point.value);
    const ticks = niceTicks(Math.min(...values), Math.max(...values), integer, MIN_STEP[series]);
    const [yMin, yMax] = [ticks[0], ticks[ticks.length - 1]];
    const [tMin, tMax] = [Math.min(...times), Math.max(...times)];
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = (time: number) => MARGIN.left + (tMax === tMin ? plotWidth / 2 : ((time - tMin) / (tMax - tMin)) * plotWidth);
    const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
    return { ticks, coordinates: points.map((point, index) => ({ x: x(times[index]), y: y(point.value) })), y, plotWidth, plotHeight };
  }, [points, width, integer, series]);

  const { coordinates } = layout;
  const tickStep = layout.ticks.length > 1 ? layout.ticks[1] - layout.ticks[0] : 1;
  const formatTick = (value: number) => TICK_FORMAT[series](value, tickStep);
  const last = coordinates[coordinates.length - 1];
  const current = active === null ? null : { point: points[active], ...coordinates[active] };

  const nearest = (clientX: number, target: SVGRectElement) => {
    const pointerX = clientX - target.getBoundingClientRect().left + MARGIN.left;
    let best = 0;
    coordinates.forEach((coordinate, index) => {
      if (Math.abs(coordinate.x - pointerX) < Math.abs(coordinates[best].x - pointerX)) best = index;
    });
    setActive(best);
  };

  const tooltipWidth = 148;
  const tooltipX = current ? Math.min(Math.max(current.x - tooltipWidth / 2, 4), width - tooltipWidth - 4) : 0;
  const tooltipY = current ? (current.y > MARGIN.top + 56 ? current.y - 54 : current.y + 14) : 0;

  return (
    <figure className="panel p-4" data-series={series}>
      <figcaption id={titleId} className="eyebrow mb-2">
        {title}
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId}>
          {layout.ticks.map((tick) => (
            <g key={tick}>
              <line className="trend-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick)} y2={layout.y(tick)} />
              <text className="trend-axis" x={MARGIN.left - 8} y={layout.y(tick)} textAnchor="end" dominantBaseline="middle">
                {formatTick(tick)}
              </text>
            </g>
          ))}
          <text className="trend-axis" x={MARGIN.left} y={HEIGHT - 8} textAnchor="start">
            {points[0].dateLabel}
          </text>
          {points.length > 1 && (
            <text className="trend-axis" x={width - MARGIN.right} y={HEIGHT - 8} textAnchor="end">
              {points[points.length - 1].dateLabel}
            </text>
          )}

          {current && <line className="trend-crosshair" x1={current.x} x2={current.x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />}
          <polyline className="trend-line" points={coordinates.map((c) => `${c.x},${c.y}`).join(" ")} />
          {coordinates.map((coordinate, index) => (
            <circle
              key={points[index].at}
              className="trend-marker"
              cx={coordinate.x}
              cy={coordinate.y}
              r={active === index ? 5.5 : 4}
              tabIndex={0}
              role="img"
              aria-label={`${points[index].dateLabel} : ${points[index].label}`}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
            />
          ))}
          {/* Valeur courante, directement au bout de la courbe. */}
          <text className="trend-value" x={last.x + 10} y={last.y} dominantBaseline="middle">
            {points[points.length - 1].valueLabel ?? formatTick(points[points.length - 1].value)}
          </text>

          {/* Zone de survol : plus large que les marques, elle vise le point le plus proche. */}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(layout.plotWidth, 0)}
            height={layout.plotHeight}
            fill="transparent"
            onPointerMove={(event) => nearest(event.clientX, event.currentTarget)}
            onPointerLeave={() => setActive(null)}
          />

          {current && (
            <g className="trend-tooltip" transform={`translate(${tooltipX}, ${tooltipY})`} pointerEvents="none">
              <rect width={tooltipWidth} height={42} rx={8} />
              <text className="trend-tooltip-value" x={10} y={18}>
                {current.point.label}
              </text>
              <text className="trend-tooltip-date" x={10} y={33}>
                {current.point.dateLabel}
              </text>
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}
