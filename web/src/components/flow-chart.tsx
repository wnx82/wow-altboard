"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type FlowColumn = {
  key: string;
  /** Étiquette sous la colonne. */
  axisLabel: string;
  /** Montants en pièces de cuivre, positifs : les revenus montent, les dépenses descendent. */
  income: number;
  expense: number;
  /** Bilan de la colonne ; null quand rien n'a été joué (aucun repère posé). */
  net: number | null;
  ariaLabel: string;
  /** Lignes de l'infobulle ; la première est le titre. */
  tooltip: string[];
};

type Props = { title: string; note: string; columns: FlowColumn[] };

const HEIGHT = 260;
const MARGIN = { top: 18, right: 12, bottom: 30, left: 56 };
const MAX_BAR = 24;
/** Écart, dans la couleur de la surface, entre une colonne de revenus et celle de dépenses. */
const GAP = 1;
const tickFormat = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const LEGEND = [
  ["income", "Revenus"],
  ["expense", "Dépenses"],
  ["net", "Bilan"],
] as const;

/** Pas « rond » pour couvrir une étendue en quatre graduations environ. */
function niceStep(range: number): number {
  if (range <= 0) return 1;
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
}

/** Colonne arrondie du côté de sa valeur, droite contre l'axe ; vers le haut ou vers le bas. */
function columnPath(x: number, width: number, from: number, to: number): string {
  const up = to < from;
  const radius = Math.min(4, width / 2, Math.abs(from - to));
  const sign = up ? 1 : -1;
  return `M${x},${from} V${to + sign * radius} Q${x},${to} ${x + radius},${to} H${x + width - radius} Q${x + width},${to} ${x + width},${to + sign * radius} V${from} Z`;
}

/**
 * Revenus au-dessus de l'axe, dépenses en dessous, bilan en repère : un seul axe, en pièces. Chaque
 * valeur reste accessible sans survol : au clavier (bandes focalisables) et dans le tableau par jour.
 */
export function FlowChart({ title, note, columns }: Props) {
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
    const maxIncome = Math.max(0, ...columns.map((column) => column.income));
    const maxExpense = Math.max(0, ...columns.map((column) => column.expense));
    const highest = Math.max(maxIncome, maxExpense);
    // La plus grande pièce que la plus haute colonne atteint.
    const unit = highest >= 10_000 ? { size: 10_000, suffix: " po" } : highest >= 100 ? { size: 100, suffix: " pa" } : { size: 1, suffix: " pc" };
    const step = Math.max(unit.size === 1 ? 1 : 0, niceStep((maxIncome + maxExpense) / unit.size)) * unit.size;
    // Toujours une graduation au-dessus de l'axe ; une en dessous seulement s'il y a des dépenses.
    const top = Math.max(1, Math.ceil(maxIncome / step)) * step;
    const bottom = Math.ceil(maxExpense / step) * step;
    const plotWidth = width - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    // Sous la plus forte dépense, sa valeur : la place lui est gardée au-dessus des dates.
    const scaleHeight = plotHeight - (maxExpense > 0 ? 18 : 0);
    const zero = MARGIN.top + (top / (top + bottom)) * scaleHeight;
    const y = (value: number) => zero - (value / (top + bottom)) * scaleHeight;
    const ticks: number[] = [];
    for (let tick = -bottom; tick <= top + step / 2; tick += step) ticks.push(Math.round(tick));
    const band = plotWidth / columns.length;
    const barWidth = Math.min(MAX_BAR, band * 0.62);
    // Une étiquette toutes les k colonnes quand elles se resserrent : la place dépend de leur longueur.
    const labelWidth = 12 + 7 * Math.max(...columns.map((column) => column.axisLabel.length));
    const every = Math.max(1, Math.ceil(labelWidth / band));
    // Seuls les extrêmes portent leur valeur : le reste est dans l'infobulle et le tableau.
    const topIncome = maxIncome > 0 ? columns.findIndex((column) => column.income === maxIncome) : -1;
    const topExpense = maxExpense > 0 ? columns.findIndex((column) => column.expense === maxExpense) : -1;
    return { unit, ticks, band, barWidth, zero, y, every, plotHeight, topIncome, topExpense };
  }, [columns, width]);

  const { band, barWidth, zero, y } = layout;
  const center = (index: number) => MARGIN.left + band * (index + 0.5);
  const tooltipLines = active === null ? [] : columns[active].tooltip;
  const tooltipWidth = 214;
  const tooltipHeight = 12 + tooltipLines.length * 16;
  const tooltipX = active === null ? 0 : Math.min(Math.max(center(active) - tooltipWidth / 2, 4), width - tooltipWidth - 4);
  const tickLabel = (tick: number) => `${tick < 0 ? "−" : ""}${tickFormat.format(Math.abs(tick) / layout.unit.size)}${layout.unit.suffix}`;

  return (
    <figure className="panel p-4" data-series="flow">
      <figcaption className="mb-3 space-y-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span id={titleId} className="eyebrow">
            {title}
          </span>
          <span className="text-xs text-muted">{note}</span>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {LEGEND.map(([key, label]) => (
            <span key={key} className="legend-key">
              <span className="legend-swatch" data-key={key} aria-hidden="true" />
              {label}
            </span>
          ))}
        </span>
      </figcaption>
      <div ref={frame}>
        <svg className="trend-chart" width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-labelledby={titleId}>
          {layout.ticks.map((tick) => (
            <g key={tick}>
              {tick !== 0 && <line className="trend-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />}
              <text className="trend-axis" x={MARGIN.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {tickLabel(tick)}
              </text>
            </g>
          ))}

          {columns.map((column, index) => {
            const x = center(index) - barWidth / 2;
            // La dernière colonne est toujours étiquetée ; une étiquette trop proche d'elle est omise.
            const last = columns.length - 1;
            const labelled = index === last || (index % layout.every === 0 && last - index >= layout.every);
            const isActive = active === index || undefined;
            return (
              <g key={column.key}>
                {column.income > 0 && (
                  <path className="flow-income" data-active={isActive} d={columnPath(x, barWidth, zero - GAP, Math.min(y(column.income), zero - GAP - 1))} />
                )}
                {column.expense > 0 && (
                  <path className="flow-expense" data-active={isActive} d={columnPath(x, barWidth, zero + GAP, Math.max(y(-column.expense), zero + GAP + 1))} />
                )}
                {column.net !== null && <circle className="flow-net" cx={center(index)} cy={y(column.net)} r={4} />}
                {index === layout.topIncome && (
                  <text className="trend-value" x={center(index)} y={y(column.income) - 8} textAnchor="middle">
                    {tickLabel(column.income)}
                  </text>
                )}
                {index === layout.topExpense && (
                  <text className="trend-value" x={center(index)} y={y(-column.expense) + 16} textAnchor="middle">
                    {tickLabel(-column.expense)}
                  </text>
                )}
                {labelled && (
                  <text className="trend-axis" x={center(index)} y={HEIGHT - 10} textAnchor="middle">
                    {column.axisLabel}
                  </text>
                )}
                {/* Zone de survol : toute la bande, bien plus large que les colonnes. */}
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
          <line className="trend-baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={zero} y2={zero} />

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
