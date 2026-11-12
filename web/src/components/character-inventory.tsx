"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { expiryFlag, fold, holdingNote, holdingsValue, PLACE_LABELS } from "@/lib/dashboard/inventory-view";
import { itemHref } from "@/lib/economy/view";
import { formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { GameTooltip, ItemSlot, itemName, TooltipPrice, useItemTip, ValueEstimate, type SlotItem } from "./item-slots";

// Inventaire d'un personnage sur sa fiche : une fenêtre de sac comme en jeu, un endroit par section,
// les mêmes cases et la même bulle que la page Inventaires.

type Place = "bags" | "bank" | "mail" | "auctions";

export type CharacterInventoryPlace = {
  place: Place;
  /** Date du relevé (ISO) ; null quand l'endroit n'a jamais été relevé. */
  seen: string | null;
  /** Message affiché à la place des cases quand l'endroit n'a jamais été relevé. */
  never: string;
  items: { itemKey: string; quantity: number; expiresAt: string | null }[];
};

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function CharacterInventory({
  characterId,
  places,
  items,
  prices,
  market,
  now: nowIso,
}: {
  characterId: number;
  places: CharacterInventoryPlace[];
  items: Record<string, SlotItem>;
  prices: Record<string, number>;
  market: string | null;
  now: string;
}) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [query, setQuery] = useState("");
  const { tip, events, close } = useItemTip();

  // Meilleure qualité d'abord, puis par nom : l'ordre des sacs en jeu n'est pas relevé.
  const sorted = useMemo(
    () =>
      places.map((place) => ({
        ...place,
        items: [...place.items].sort(
          (a, b) => (items[b.itemKey]?.quality ?? -1) - (items[a.itemKey]?.quality ?? -1) || collator.compare(itemName(items[a.itemKey], a.itemKey), itemName(items[b.itemKey], b.itemKey)),
        ),
      })),
    [places, items],
  );
  const needle = fold(query.trim());
  const shown = sorted.map((place) => ({
    ...place,
    items: needle === "" ? place.items : place.items.filter((item) => fold(itemName(items[item.itemKey], item.itemKey)).includes(needle) || item.itemKey === needle),
  }));
  const worth = holdingsValue(
    places.flatMap((place) => place.items),
    prices,
    now,
  );
  const matches = shown.reduce((sum, place) => sum + place.items.length, 0);
  const total = places.reduce((sum, place) => sum + place.items.length, 0);

  const tipped = tip ? shown.find((place) => tip.slotId.startsWith(`${place.place}:`)) : undefined;
  const tipItem = tipped?.items.find((item) => `${tipped.place}:${item.itemKey}` === tip?.slotId);
  const tipNote = tipItem ? holdingNote(tipItem.expiresAt, now) : undefined;

  return (
    <section className="bag-window p-3 sm:p-4" aria-label="Inventaire">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          type="search"
          className="field min-w-0 flex-1 sm:max-w-xs"
          placeholder="Chercher dans l'inventaire…"
          aria-label="Chercher un objet dans l'inventaire de ce personnage"
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            close();
          }}
        />
        <p className="text-xs text-muted" aria-live="polite">
          {needle === "" ? `${formatInteger(total)} objet${total > 1 ? "s" : ""}` : `${formatInteger(matches)} sur ${formatInteger(total)}`}
          {market && total > 0 && (
            <>
              {" · "}
              <ValueEstimate copper={worth.value} unpriced={worth.unpriced} />
            </>
          )}
        </p>
        <span className="flex-1" />
        <Link href={`/inventory?perso=${characterId}`} className="text-xs text-gold hover:underline">
          Ouvrir dans Inventaires ›
        </Link>
      </div>

      {shown.map((place) => {
        const copies = place.items.reduce((sum, item) => sum + item.quantity, 0);
        return (
          <div key={place.place} className="bag-section">
            <h3 className="bag-section-title">
              <span>
                {PLACE_LABELS[place.place]}
                {place.seen && (
                  <small>
                    {" "}
                    · {formatInteger(copies)} exemplaire{copies > 1 ? "s" : ""}
                  </small>
                )}
              </span>
              {place.seen && <small title={formatDateTime(place.seen)}>relevé {formatRelative(place.seen, now)}</small>}
            </h3>
            {place.seen === null ? (
              <p className="text-sm text-muted">{place.never}</p>
            ) : place.items.length === 0 ? (
              <p className="text-sm text-muted">{needle === "" ? "Vide." : "Aucun objet ne correspond."}</p>
            ) : (
              <ul className="bag-grid">
                {place.items.map((item) => (
                  <li key={item.itemKey}>
                    <ItemSlot
                      info={items[item.itemKey]}
                      itemKey={item.itemKey}
                      slotId={`${place.place}:${item.itemKey}`}
                      quantity={item.quantity}
                      flag={expiryFlag(item.expiresAt, now)}
                      tip={tip}
                      events={events}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {tip && tipped && tipItem && (
        <GameTooltip tip={tip} title={itemName(items[tipItem.itemKey], tipItem.itemKey)} quality={items[tipItem.itemKey]?.quality} onClose={close}>
          <p className="text-[0.72rem] text-[#8f9bb8]">
            {items[tipItem.itemKey]?.quality == null ? "" : `${QUALITY_LABELS[items[tipItem.itemKey]!.quality!]} · `}objet n° {tipItem.itemKey.split(":")[0]}
          </p>
          <div className="tooltip-rule" />
          <p className="flex items-baseline justify-between gap-6">
            <span className="text-[#ffd100]">{PLACE_LABELS[tipped.place]}</span>
            <span className="font-semibold tabular-nums">{formatInteger(tipItem.quantity)}</span>
          </p>
          {tipNote && <p className={tipNote.warn ? "text-[#ff6b62]" : "text-[#8f9bb8]"}>{tipNote.text}</p>}
          {market && <TooltipPrice unit={prices[tipItem.itemKey] ?? null} quantity={tipItem.quantity} />}
          {tip.pinned && prices[tipItem.itemKey] !== undefined && (
            <p className="mt-2">
              <Link href={itemHref(tipItem.itemKey)} className="text-[0.75rem] text-gold hover:underline">
                Cours de l&apos;objet au marché ›
              </Link>
            </p>
          )}
        </GameTooltip>
      )}
    </section>
  );
}
