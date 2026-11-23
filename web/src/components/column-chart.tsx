"use client";

import { useId, useMemo, useState } from "react";
import { ChartAnnouncer, ChartGrid, ChartTooltip, useChartKeyboard, useChartWidth } from "@/components/chart-parts";
import { coinUnit, isLabelled, labelEvery, ticksUpTo, tooltipLeft } from "@/lib/chart/scale";

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
const TOOLTIP_WIDTH = 214;
const tickFormat = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Colonne à sommet arrondi et base droite, posée sur l'axe. */
function columnPath(x: number, top: number, width: number, baseline: number): string {
  const radius = Math.min(4, width / 2, Math.max(baseline - top, 0));
  return `M${x},${baseline} V${top + radius} Q${x},${top} ${x + radius},${top} H${x + width - radius} Q${x + width},${top} ${x + width},${top + radius} V${baseline} Z`;
}

/**
 * Colonnes d'une seule mesure sur un seul axe. Chaque valeur reste accessible sans survol : au
 * clavier (un arrêt de tabulation, puis les flèches) et dans le tableau qui accompagne le graphique.
 */
export function ColumnChart({ title, note, series, scale, columns }: Props) {
  const titleId = useId();
  const [frame, width] = useChartWidth(720);
  const [active, setActive] = useState<number | null>(null);
  const keyboard = useChartKeyboard(columns.length, active, setActive);

  const layout = useMemo(() => {
    const highest = Math.max(0, ...columns.map((column) => column.value ?? 0));
    // Durées : minutes tant que tout tient en moins de deux heures, heures au-delà. Montants : la
    // plus grande pièce que la colonne la plus haute atteint.
    const unit =
      scale === "count"
        ? { size: 1, suffix: "" }
        : scale === "money"
          ? coinUnit(highest)
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
    const every = labelEvery(columns.map((column) => column.axisLabel), band);
    return { unit, ticks, band, barWidth, baseline, y, every, plotHeight };
  }, [columns, width, scale]);

  const { band, barWidth, baseline } = layout;
  const center = (index: number) => MARGIN.left + band * (index + 0.5);

  return (
    <figure className="panel p-4" data-series={series}>
      <figcaption id={titleId} className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{title}</span>
        <span className="text-xs text-muted">{note}</span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId} {...keyboard.svgProps}>
          <ChartGrid
            ticks={layout.ticks}
            y={(tick) => layout.y(tick * layout.unit.size)}
            left={MARGIN.left}
            right={width - MARGIN.right}
            label={(tick) => `${tickFormat.format(tick)}${layout.unit.suffix}`}
          />

          {columns.map((column, index) => {
            const x = center(index) - barWidth / 2;
            const isActive = active === index || undefined;
            return (
              <g key={column.key}>
                {column.value === null ? (
                  // Valeur non mesurée : marque creuse sur l'axe, jamais une valeur inventée.
                  <circle className="column-unknown" cx={center(index)} cy={baseline - 5} r={3.5} />
                ) : (
                  <path className="column-bar" data-partial={column.partial || undefined} data-active={isActive} d={columnPath(x, Math.min(layout.y(column.value), baseline - 1), barWidth, baseline)} />
                )}
                {columns.length <= 14 && column.value !== null && (
                  <text className="trend-value" x={center(index)} y={layout.y(column.value) - 7} textAnchor="middle">
                    {column.valueLabel}
                  </text>
                )}
                {isLabelled(index, columns.length, layout.every) && (
                  <text className="trend-axis" x={center(index)} y={HEIGHT - 10} textAnchor="middle">
                    {column.axisLabel}
                  </text>
                )}
                {/* Zone de survol : toute la bande, bien plus large que la colonne. */}
                <rect
                  className="chart-band"
                  data-active={isActive}
                  x={MARGIN.left + band * index}
                  y={MARGIN.top}
                  width={band}
                  height={layout.plotHeight}
                  fill="transparent"
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
          <line className="trend-baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={baseline} y2={baseline} />

          {active !== null && <ChartTooltip x={tooltipLeft(center(active), TOOLTIP_WIDTH, width)} y={MARGIN.top - 6} width={TOOLTIP_WIDTH} lines={columns[active].tooltip} />}
        </svg>
      </div>
      <ChartAnnouncer hintId={keyboard.hintId} text={active === null ? null : columns[active].ariaLabel} />
    </figure>
  );
}
