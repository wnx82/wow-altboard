"use client";

import { useEffect, useRef, useState } from "react";
import { GameIcon } from "./ui";

/** `icon` : adresse d'une icône du jeu, posée devant le libellé. */
export type SectionLink = { id: string; label: string; icon?: string };

/** Hauteur de l'en-tête et du sommaire : un titre passé sous cette ligne est en cours de lecture. */
const READING_LINE = 140;

/**
 * Sommaire d'une longue page. Il reste sous l'en-tête pendant la lecture et marque la section en
 * cours ; chaque lien mène au titre de la section, repéré par son identifiant.
 */
export function SectionNav({ label, items }: { label: string; items: SectionLink[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const targets = items.map((item) => document.getElementById(item.id)).filter((target) => target !== null);
    // La section en cours est la dernière dont le titre a passé la ligne de lecture.
    const update = () => {
      let reading: string | null = null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= READING_LINE) reading = target.id;
      }
      setCurrent(reading);
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
    };
  }, [items]);

  // Sur un écran étroit le sommaire défile de côté : le lien de la section en cours y reste visible.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    <nav aria-label={label} className="section-nav">
      <ul ref={list} className="scroll-row">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="section-link" aria-current={current === item.id ? "true" : undefined}>
              {item.icon && <GameIcon src={item.icon} size={20} className="section-link-icon" />}
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
