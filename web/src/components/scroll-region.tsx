"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Conteneur à défilement horizontal d'un tableau large. Quand le tableau déborde, le conteneur
 * devient un arrêt de tabulation nommé : les flèches le font défiler sans souris. Tant qu'il tient
 * dans la largeur, il ne prend pas de place dans l'ordre de tabulation.
 */
export function ScrollRegion({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const region = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const measure = () => setScrollable(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={region}
      className={className ?? "overflow-x-auto"}
      {...(scrollable ? { tabIndex: 0, role: "region", "aria-label": `${label} (défilement horizontal)` } : {})}
    >
      {children}
    </div>
  );
}
