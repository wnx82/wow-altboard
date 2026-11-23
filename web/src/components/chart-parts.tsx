"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { stepIndex } from "@/lib/chart/scale";

// Pièces communes aux graphiques SVG : largeur suivie, grille, infobulle et navigation au clavier.

/** Largeur du cadre du graphique, suivie au redimensionnement ; 280 px au moins. */
export function useChartWidth(initial: number) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [frame, width] as const;
}

/**
 * Un seul arrêt de tabulation par graphique : les flèches passent d'une valeur à l'autre, Début et
 * Fin vont aux extrémités, Échap efface. À l'entrée au clavier, la dernière valeur (la plus récente)
 * est désignée ; un clic de souris ne désigne rien, le survol s'en charge. La valeur désignée est
 * lue par la région annoncée (ChartAnnouncer).
 */
export function useChartKeyboard(count: number, active: number | null, setActive: (index: number | null) => void) {
  const hintId = useId();
  return {
    hintId,
    svgProps: {
      tabIndex: 0,
      "aria-describedby": hintId,
      onFocus: (event: FocusEvent<SVGSVGElement>) => {
        if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible") && active === null && count > 0) setActive(count - 1);
      },
      onBlur: (event: FocusEvent<SVGSVGElement>) => {
        if (event.target === event.currentTarget) setActive(null);
      },
      onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => {
        const next = stepIndex(event.key, active, count);
        if (next === undefined) return;
        event.preventDefault();
        setActive(next);
      },
    },
  };
}

/** Consigne du clavier et valeur désignée, lues par les lecteurs d'écran ; invisibles à l'écran. */
export function ChartAnnouncer({ hintId, text }: { hintId: string; text: string | null }) {
  return (
    <>
      <span id={hintId} className="sr-only">
        Flèches gauche et droite pour parcourir les valeurs, Début et Fin pour les extrémités.
      </span>
      <span className="sr-only" aria-live="polite">
        {text ?? ""}
      </span>
    </>
  );
}

/** Lignes horizontales de la grille et leurs graduations, à gauche du tracé. */
export function ChartGrid({
  ticks,
  y,
  left,
  right,
  label,
  skipLine,
}: {
  ticks: number[];
  y: (tick: number) => number;
  left: number;
  right: number;
  label: (tick: number) => string;
  /** Graduation sans ligne : l'axe y est déjà tracé. */
  skipLine?: (tick: number) => boolean;
}) {
  return (
    <>
      {ticks.map((tick) => (
        <g key={tick}>
          {!skipLine?.(tick) && <line className="trend-grid" x1={left} x2={right} y1={y(tick)} y2={y(tick)} />}
          <text className="trend-axis" x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
            {label(tick)}
          </text>
        </g>
      ))}
    </>
  );
}

/** Infobulle : la première ligne est la valeur, les suivantes son contexte. */
export function ChartTooltip({ x, y, width, lines }: { x: number; y: number; width: number; lines: string[] }) {
  return (
    <g className="trend-tooltip" transform={`translate(${x}, ${y})`} pointerEvents="none">
      <rect width={width} height={tooltipHeight(lines.length)} rx={8} />
      {lines.map((line, index) => (
        <text key={`${index}-${line}`} className={index === 0 ? "trend-tooltip-value" : "trend-tooltip-date"} x={10} y={19 + index * 16}>
          {line}
        </text>
      ))}
    </g>
  );
}

export function tooltipHeight(lines: number): number {
  return 12 + lines * 16;
}
