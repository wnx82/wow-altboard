"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import type { InventoryCharacter, InventoryData, InventoryGuild } from "@/lib/dashboard/inventory";
import {
  expiryFlag,
  groupByCharacter,
  groupByGuild,
  holdingNote,
  holdingsValue,
  type Holding,
  type InventoryPlace,
  type InventorySort,
  type ItemRow,
  PLACE_LABELS,
  type PlaceGroup,
  rowFlag,
  sortHoldings,
} from "@/lib/dashboard/inventory-view";
import { itemHref } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { GameTooltip, ItemDetails, ItemSlot, itemName, TooltipPrice, ValueEstimate, type SlotEvents, type Tip } from "./item-slots";
import { ClassAvatar, Money } from "./ui";

// Cases de la page Inventaires : grille des objets regroupés, bulle d'un objet et fenêtres sac par sac.

/** Détenteurs listés dans la bulle d'un objet ; les suivants sont comptés. */
const TOOLTIP_HOLDERS = 12;

export const plural = (count: number, word: string) => `${formatInteger(count)} ${word}${count > 1 ? "s" : ""}`;

/** Ce qu'il faut à chaque case : la description des objets, les prix, la bulle ouverte et ses gestionnaires. */
export type SlotContext = { items: InventoryData["items"]; prices: InventoryData["prices"]; tip: Tip | null; events: SlotEvents };

/**
 * Grille des objets regroupés. Mémoïsée : un survol ne redessine que la grille qui contient la case
 * survolée (tip vaut null pour toutes les autres).
 */
export const ItemGrid = memo(function ItemGrid({
  rows,
  items,
  now,
  tip,
  events,
}: {
  rows: readonly ItemRow[];
  items: InventoryData["items"];
  now: Date;
  tip: Tip | null;
  events: SlotEvents;
}) {
  return (
    <ul className="bag-grid" data-size="lg">
      {rows.map((row) => (
        <li key={row.itemKey}>
          <ItemSlot info={items[row.itemKey]} itemKey={row.itemKey} slotId={`all:${row.itemKey}`} quantity={row.total} flag={rowFlag(row.holdings, now)} tip={tip} events={events} />
        </li>
      ))}
    </ul>
  );
});

/** Bulle d'objet : nom à la couleur de la qualité, total et valeur, puis chaque détenteur. */
export function ItemTooltip({
  row,
  data,
  tip,
  characters,
  guilds,
  now,
  onClose,
}: {
  row: ItemRow;
  data: InventoryData;
  tip: Tip;
  characters: Map<number, InventoryCharacter>;
  guilds: Map<number, InventoryGuild>;
  now: Date;
  onClose: () => void;
}) {
  const info = data.items[row.itemKey];
  const shown = row.holdings.slice(0, TOOLTIP_HOLDERS);
  const hidden = row.holdings.length - shown.length;
  const itemId = row.itemKey.split(":")[0];

  return (
    <GameTooltip tip={tip} title={itemName(info, row.itemKey)} quality={info?.quality} onClose={onClose}>
      <p className="text-[0.72rem] text-[#8f9bb8]">
        {info?.quality == null ? "" : `${QUALITY_LABELS[info.quality]} · `}objet n° {itemId}
      </p>
      <ItemDetails itemKey={row.itemKey} gear={info?.gear} pinned={tip.pinned} />
      <div className="tooltip-rule" />
      <p className="flex items-baseline justify-between gap-6">
        <span className="text-[#ffd100]">Total</span>
        <span className="font-semibold tabular-nums">{formatInteger(row.total)}</span>
      </p>
      {data.market && <TooltipPrice unit={row.unit} quantity={row.total} />}
      <ul className="mt-1.5 space-y-0.5">
        {shown.map((holding) => (
          <TooltipHolder key={holdingKey(holding)} holding={holding} characters={characters} guilds={guilds} now={now} />
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-[0.72rem] text-[#8f9bb8]">
          et {formatInteger(hidden)} autre{hidden > 1 ? "s" : ""} détenteur{hidden > 1 ? "s" : ""}
        </p>
      )}
      {tip.pinned && row.unit !== null && (
        <p className="mt-2">
          <Link href={itemHref(row.itemKey)} className="text-[0.75rem] text-gold hover:underline">
            Cours de l&apos;objet au marché ›
          </Link>
        </p>
      )}
    </GameTooltip>
  );
}

const holdingKey = (holding: Holding) =>
  holding.kind === "guild" ? `g${holding.guildId}-${holding.tab}` : `c${holding.characterId}-${holding.location}`;

function tabLabel(guild: InventoryGuild | undefined, tab: number) {
  return guild?.tabs.find((candidate) => candidate.index === tab)?.name ?? `Onglet ${tab}`;
}

/** Un détenteur dans la bulle : personnage et endroit, ou guilde et onglet, avec la quantité. */
function TooltipHolder({
  holding,
  characters,
  guilds,
  now,
}: {
  holding: Holding;
  characters: Map<number, InventoryCharacter>;
  guilds: Map<number, InventoryGuild>;
  now: Date;
}) {
  if (holding.kind === "guild") {
    const guild = guilds.get(holding.guildId);
    return (
      <li className="flex items-baseline justify-between gap-6">
        <span className="min-w-0 truncate">
          <span className="text-[#40ff40]">&lt;{guild?.name ?? "Guilde"}&gt;</span> <span className="text-[#8f9bb8]">· {tabLabel(guild, holding.tab)}</span>
        </span>
        <span className="tabular-nums">{formatInteger(holding.quantity)}</span>
      </li>
    );
  }
  const character = characters.get(holding.characterId);
  const note = holdingNote(holding.expiresAt, now);
  return (
    <li className="flex items-baseline justify-between gap-6" data-class={classKey(character?.class ?? null)}>
      <span className="min-w-0 truncate">
        <Link href={`/characters/${holding.characterId}`} className="class-text hover:underline">
          {character?.name ?? "?"}
        </Link>{" "}
        <span className="text-[#8f9bb8]">· {PLACE_LABELS[holding.location]}</span>
        {note && <span className={note.warn ? "text-[#ff6b62]" : "text-[#8f9bb8]"}> · {note.text}</span>}
      </span>
      <span className="tabular-nums">{formatInteger(holding.quantity)}</span>
    </li>
  );
}

/** Une fenêtre par personnage, puis par banque de guilde ; chaque endroit ou onglet en grille de cases. */
export function BagWindows({ holdings, data, sort, now, slot }: { holdings: Holding[]; data: InventoryData; sort: InventorySort; now: Date; slot: SlotContext }) {
  const byCharacter = useMemo(() => groupByCharacter(holdings), [holdings]);
  const byGuild = useMemo(() => groupByGuild(holdings), [holdings]);
  const shownCharacters = data.characters.filter((character) => byCharacter.has(character.id));
  const shownGuilds = data.guilds.filter((guild) => byGuild.has(guild.id));
  if (shownCharacters.length === 0 && shownGuilds.length === 0) return null;
  const single = shownCharacters.length + shownGuilds.length === 1;
  const columns = single ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 xl:grid-cols-2";

  return (
    <div className="space-y-8">
      {shownCharacters.length > 0 && (
        <div className={columns}>
          {shownCharacters.map((character) => {
            const groups = byCharacter.get(character.id)!;
            const worth = holdingsValue(groups.flatMap((group) => group.holdings), data.prices, now);
            return (
              <section key={character.id} className="bag-window p-3 sm:p-4" aria-labelledby={`inventory-character-${character.id}`} data-class={classKey(character.class)}>
                <header className="mb-3 flex items-center gap-3">
                  <ClassAvatar name={character.name} classToken={character.class} size="sm" level={character.level} />
                  <div className="min-w-0 flex-1">
                    <h2 id={`inventory-character-${character.id}`} className="bag-title truncate text-lg font-semibold">
                      <Link href={`/characters/${character.id}`} className="class-text hover:underline">
                        {character.name}
                      </Link>
                    </h2>
                    <p className="truncate text-xs text-muted">
                      {character.realm} · {character.account.label}
                    </p>
                  </div>
                  {data.market && (
                    <span className="flex-none text-sm">
                      <ValueEstimate copper={worth.value} unpriced={worth.unpriced} />
                    </span>
                  )}
                </header>
                {groups.map((group) => (
                  <BagSection
                    key={group.place}
                    scope={`c${character.id}-${group.place}`}
                    title={PLACE_LABELS[group.place]}
                    seen={character.seen[group.place as Exclude<InventoryPlace, "guild">]}
                    group={group}
                    sort={sort}
                    now={now}
                    large={single}
                    slot={slot}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {shownGuilds.length > 0 && (
        <div>
          <h2 className="bag-title mb-3 text-lg font-semibold">Banques de guilde</h2>
          <div className={columns}>
            {shownGuilds.map((guild) => {
              const groups = byGuild.get(guild.id)!;
              const worth = holdingsValue(groups.flatMap((group) => group.holdings), data.prices, now);
              return (
                <section key={guild.id} className="bag-window p-3 sm:p-4" aria-labelledby={`inventory-guild-${guild.id}`}>
                  <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <h3 id={`inventory-guild-${guild.id}`} className="bag-title truncate text-lg font-semibold text-[#40ff40]">
                        &lt;{guild.name}&gt;
                      </h3>
                      <p className="truncate text-xs text-muted">
                        {guild.realm} · vue depuis {guild.accountLabel}
                      </p>
                    </div>
                    <span className="flex flex-col items-end gap-0.5 text-sm">
                      <Money copper={guild.moneyCopper} />
                      {data.market && (
                        <span className="text-xs">
                          objets <ValueEstimate copper={worth.value} unpriced={worth.unpriced} />
                        </span>
                      )}
                    </span>
                  </header>
                  {groups.map((group) => (
                    <BagSection key={group.tab} scope={`g${guild.id}-${group.tab}`} title={tabLabel(guild, group.tab ?? 0)} seen={guild.seenAt} group={group} sort={sort} now={now} large={single} slot={slot} />
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BagSection({
  scope,
  title,
  seen,
  group,
  sort,
  now,
  large,
  slot,
}: {
  scope: string;
  title: string;
  seen: string | null;
  group: PlaceGroup;
  sort: InventorySort;
  now: Date;
  large: boolean;
  slot: SlotContext;
}) {
  const total = group.holdings.reduce((sum, holding) => sum + holding.quantity, 0);
  const sorted = sortHoldings(group.holdings, slot.items, sort, slot.prices);
  return (
    <div className="bag-section">
      <h4 className="bag-section-title">
        <span>
          {title} <small>· {plural(total, "exemplaire")}</small>
        </span>
        {seen && (
          <small title={formatDateTime(seen)}>
            relevé {formatRelative(seen, now)}
          </small>
        )}
      </h4>
      <ul className="bag-grid" data-size={large ? "lg" : undefined}>
        {sorted.map((holding) => (
          <li key={holding.itemKey}>
            <ItemSlot
              info={slot.items[holding.itemKey]}
              itemKey={holding.itemKey}
              slotId={`${scope}:${holding.itemKey}`}
              quantity={holding.quantity}
              flag={holding.kind === "character" ? expiryFlag(holding.expiresAt, now) : null}
              tip={slot.tip}
              events={slot.events}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
