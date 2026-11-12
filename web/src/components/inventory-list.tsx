"use client";

import { useMemo, useState } from "react";
import { QUALITY_LABELS } from "@/lib/wow/format";

/** note : précision affichée avant la quantité, par exemple l'échéance d'un courrier. */
export type InventoryItem = { itemKey: string; name: string | null; quality: number | null; quantity: number; note?: { text: string; warn: boolean } };

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Contenu d'un conteneur (sacs ou banque), avec recherche instantanée sur le nom. */
export function InventoryList({ items, label }: { items: InventoryItem[]; label: string }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return needle ? items.filter((item) => fold(item.name ?? item.itemKey).includes(needle)) : items;
  }, [items, query]);

  if (items.length === 0) return <p className="text-sm text-muted">Vide.</p>;

  return (
    <div>
      <input
        type="search"
        className="field mb-3"
        placeholder={`Rechercher dans ${label}…`}
        aria-label={`Rechercher un objet dans ${label}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="mb-2 text-xs text-muted" aria-live="polite">
        {visible.length === items.length ? `${items.length} objet${items.length > 1 ? "s" : ""} différent${items.length > 1 ? "s" : ""}` : `${visible.length} sur ${items.length}`}
      </p>
      {visible.length === 0 ? (
        <p className="text-sm text-muted">Aucun objet ne correspond.</p>
      ) : (
        <ul className="max-h-96 divide-y divide-white/5 overflow-y-auto pr-1 text-sm">
          {visible.map((item) => (
            <li key={item.itemKey} className="flex items-baseline justify-between gap-3 py-1.5" data-quality={item.quality ?? undefined}>
              <span className="quality-text min-w-0 truncate" title={item.quality === null ? undefined : QUALITY_LABELS[item.quality]}>
                {item.name ?? `Objet n° ${item.itemKey}`}
              </span>
              <span className="flex flex-none items-baseline gap-3">
                {item.note && <span className={`whitespace-nowrap text-xs ${item.note.warn ? "text-danger" : "text-faint"}`}>{item.note.text}</span>}
                <span className="whitespace-nowrap tabular-nums text-muted">× {item.quantity}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
