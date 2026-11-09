"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type Column = {
  key: string | number;
  /** Étiquette sous la colonne. */
  axisLabel: string;
  /** Valeur mesurée ; null = non mesurée (marque creuse sur l'axe, jamais une valeur inventée). */
  value: number | null;
  /** Valeur lisible, posée sur la colonne quand elles sont peu nombreuses. */
  valueLabel: string;
  /** Valeur encore provisoire : colonne atténuée. */
  partial: boolean;
  ariaLabel: string;
  /** Lignes de l'infobulle ; la première est le titre. */
  tooltip: string[];
};

type Props = {
  title: string;
  note: string;
  /** La série fixe la couleur (feuille de style). */
  series: "level" | "xp" | "gold";
  /**
   * Unité de l'axe : durées en secondes (affichées en minutes ou en heures), quantités entières, ou
   * montants en pièces de cuivre (affichés en pièces d'or, d'argent ou de cuivre).
   */
  scale: "duration" | "count" | "money";
  columns: Column[];
};

const HEIGHT = 240;
const MARGIN = { top: 26, right: 12, bottom: 30, left: 48 };
const MAX_BAR = 24;
const tickFormat = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Graduations de 0 à un maximum « rond », en trois ou quatre pas. */
function ticksUpTo(max: number, integer: boolean): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) ticks.push(Number(tick.toFixed(6)));
  return ticks;
}

/** Colonne à sommet arrondi et base droite, posée sur l'axe. */
function columnPath(x: number, top: number, width: number, baseline: number): string {
  const radius = Math.min(4, width / 2, Math.max(baseline - top, 0));
  return `M${x},${baseline} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${baseline} Z`;
}

/**
 * Colonnes d'une seule mesure sur un seul axe. Chaque valeur reste accessible sans survol : au
 * clavier (colonnes focalisables) et dans le tableau qui accompagne le graphique.
 */
export function ColumnChart({ title, note, series, scale, columns }: Props) {
  const titleId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const highest = Math.max(0, ...columns.map((column) => column.value ?? 0));
    // Durées : minutes tant que tout tient en moins de deux heures, heures au-delà. Montants : la
    // plus grande pièce que la colonne la plus haute atteint.
    const unit =
      scale === "count"
        ? { size: 1, suffix: "" }
        : scale === "money"
          ? highest >= 10_000
            ? { size: 10_000, suffix: " po" }
            : highest >= 100
              ? { size: 100, suffix: " pa" }
              : { size: 1, suffix: " pc" }
          : highest < 2 * 3600
            ? { size: 60, suffix: " min" }
            : { size: 3600, suffix: " h" };
    const ticks = ticksUpTo(highest / unit.size, scale === "count" || (scale === "money" && unit.size === 1));
    const top = ticks[ticks.length - 1];
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const band = plotWidth / columns.length;
    const barWidth = Math.min(MAX_BAR, band * 0.62);
    const baseline = MARGIN.top + plotHeight;
    const y = (value: number) => baseline - (value / unit.size / top) * plotHeight;
    // Une étiquette toutes les k colonnes quand elles se resserrent : la place dépend de leur longueur.
    const labelWidth = 12 + 7 * Math.max(...columns.map((column) => column.axisLabel.length));
    const every = Math.max(1, Math.ceil(labelWidth / band));
    return { unit, ticks, band, barWidth, baseline, y, every, plotHeight };
  }, [columns, width, scale]);

  const { band, barWidth, baseline } = layout;
  const center = (index: number) => MARGIN.left + band * (index + 0.5);
  const tooltipLines = active === null ? [] : columns[active].tooltip;
  const tooltipWidth = 214;
  const tooltipHeight = 12 + tooltipLines.length * 16;
  const tooltipX = active === null ? 0 : Math.min(Math.max(center(active) - tooltipWidth / 2, 4), width - tooltipWidth - 4);

  return (
    <figure className="panel p-4" data-series={series}>
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId}>
          {layout.ticks.map((tick) => (
            <g key={tick}>
              <line className="trend-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={layout.y(tick * layout.unit.size)} y2={layout.y(tick * layout.unit.size)} />
              <text className="trend-axis" x={MARGIN.left - 8} y={layout.y(tick * layout.unit.size)} textAnchor="end" dominantBaseline="middle">
                {tickFormat.format(tick)}
                {layout.unit.suffix}
              </text>
            </g>
          ))}

          {columns.map((column, index) => {
            const x = center(index) - barWidth / 2;
            // La dernière colonne est toujours étiquetée ; une étiquette trop proche d'elle est omise.
            const last = columns.length - 1;
            const labelled = index === last || (index % layout.every === 0 && last - index >= layout.every);
            return (
              <g key={column.key}>
                {column.value === null ? (
                  // Valeur non mesurée : marque creuse sur l'axe, jamais une valeur inventée.
                  <circle className="column-unknown" cx={center(index)} cy={baseline - 5} r={3.5} />
                ) : (
                  <path
                    className="column-bar"
                    data-partial={column.partial || undefined}
                    data-active={active === index || undefined}
                    d={columnPath(x, Math.min(layout.y(column.value), baseline - 1), barWidth, baseline)}
                  />
                )}
                {columns.length <= 14 && column.value !== null && (
                  <text className="trend-value" x={center(index)} y={layout.y(column.value) - 7} textAnchor="middle">
                    {column.valueLabel}
                  </text>
                )}
                {labelled && (
                  <text className="trend-axis" x={center(index)} y={HEIGHT - 10} textAnchor="middle">
                    {column.axisLabel}
                  </text>
                )}
                {/* Zone de survol : toute la bande, bien plus large que la colonne. */}
                <rect
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={layout.plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={column.ariaLabel}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              </g>
            );
          })}
          <line className="trend-baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} />

          {active !== null && (
            <g className="trend-tooltip" transform={`translate(${tooltipX}, ${MARGIN.top - 6})`} pointerEvents="none">
              <rect width={tooltipWidth} height={tooltipHeight} rx={8} />
              {tooltipLines.map((line, index) => (
                <text key={`${index}-${line}`} className={index === 0 ? "trend-tooltip-value" : "trend-tooltip-date"} x={10} y={19 + index * 16}>
                  {line}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}
