"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryCharacter, InventoryData, InventoryGuild } from "@/lib/dashboard/inventory";
import {
  DEFAULT_STATE,
  defaultView,
  expiryFlag,
  groupByCharacter,
  groupByGuild,
  groupByItem,
  holdingNote,
  holdingsValue,
  isSoon,
  type Holding,
  type InventoryPlace,
  type InventorySort,
  type InventoryState,
  type ItemRow,
  PLACE_LABELS,
  PLACES,
  type PlaceGroup,
  readInventoryState,
  rowFlag,
  selectHoldings,
  sortHoldings,
  writeInventoryState,
} from "@/lib/dashboard/inventory-view";
import { itemHref } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { GameTooltip, ItemSlot, itemName, TooltipPrice, useItemTip, ValueEstimate, type SlotEvents, type Tip } from "./item-slots";
import { ClassAvatar, EmptyState, Money } from "./ui";

/** Cases affichées d'un coup dans la grille des objets ; le bouton du bas en ajoute autant. */
const PAGE_SIZE = 160;
/** Détenteurs listés dans la bulle d'un objet ; les suivants sont comptés. */
const TOOLTIP_HOLDERS = 12;

const SORT_LABELS: Record<InventorySort, string> = { total: "Quantité", value: "Valeur", name: "Nom", quality: "Qualité" };

const plural = (count: number, word: string) => `${formatInteger(count)} ${word}${count > 1 ? "s" : ""}`;

/** Ce qu'il faut à chaque case : la description des objets, les prix, la bulle ouverte et ses gestionnaires. */
type SlotContext = { items: InventoryData["items"]; prices: InventoryData["prices"]; tip: Tip | null; events: SlotEvents };

/** Tous les inventaires : sacs, banque, courrier, enchères et banques de guilde, en cases comme en jeu. */
export function InventoryBrowser({ data, now: nowIso }: { data: InventoryData; now: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const searchParams = useSearchParams();
  const [state, setState] = useState<InventoryState>(() => readInventoryState(searchParams));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { tip, events: slotEvents, close: closeTip } = useItemTip();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // replaceState plutôt que pushState : un filtre ne crée pas d'étape dans l'historique.
  useEffect(() => {
    const search = writeInventoryState(state, window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [state]);

  // « / » place le curseur dans la recherche, comme sur bien des sites ; sauf pendant une saisie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (patch: Partial<InventoryState>) => {
    setState((current) => ({ ...current, ...patch }));
    setLimit(PAGE_SIZE);
    closeTip();
  };

  const characters = useMemo(() => new Map(data.characters.map((character) => [character.id, character])), [data.characters]);
  const guilds = useMemo(() => new Map(data.guilds.map((guild) => [guild.id, guild])), [data.guilds]);
  const accounts = useMemo(() => {
    const byId = new Map<number, string>();
    for (const character of data.characters) byId.set(character.account.id, character.account.label);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1], "fr"));
  }, [data.characters]);

  // Seuls les endroits relevés au moins une fois sont proposés : sans Baganator, sacs et banque.
  const available = useMemo(
    () =>
      PLACES.filter((place) =>
        place === "guild" ? data.guilds.length > 0 : data.characters.some((character) => character.seen[place] !== null) || data.entries.some((entry) => entry.location === place),
      ),
    [data],
  );
  const hasExpired = useMemo(
    () => data.entries.some((entry) => entry.expiresAt !== null && new Date(entry.expiresAt).getTime() <= now.getTime()),
    [data.entries, now],
  );
  const hasSoon = useMemo(
    () => data.entries.some((entry) => entry.expiresAt !== null && new Date(entry.expiresAt).getTime() > now.getTime() && isSoon(entry.expiresAt, now)),
    [data.entries, now],
  );

  const holdings = useMemo(() => selectHoldings(data, state, now), [data, state, now]);
  const rows = useMemo(() => groupByItem(holdings, data.items, state.sort, data.prices), [holdings, data.items, state.sort, data.prices]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.itemKey, row])), [rows]);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const worth = useMemo(() => holdingsValue(holdings, data.prices, now), [holdings, data.prices, now]);

  if (data.characters.length === 0) {
    return (
      <EmptyState title="Aucun personnage synchronisé">
        Les inventaires apparaissent après la première synchronisation de l&apos;agent.
      </EmptyState>
    );
  }

  const characterOptions = data.characters.filter((character) => state.account === "" || String(character.account.id) === state.account);
  const togglePlace = (place: InventoryPlace) => {
    setState((current) => {
      const selected = current.places.includes(place) ? current.places.filter((candidate) => candidate !== place) : [...current.places, place];
      // Plus aucun endroit coché : tous reviennent, plutôt qu'une page vide.
      return { ...current, places: selected.length === 0 ? [...PLACES] : selected };
    });
    setLimit(PAGE_SIZE);
    closeTip();
  };
  const filtered =
    state.query.trim() !== "" ||
    state.account !== "" ||
    state.character !== "" ||
    state.minQuality !== "" ||
    state.soon ||
    available.some((place) => !state.places.includes(place));
  const activeFilters =
    [state.account, state.character, state.minQuality].filter((value) => value !== "").length +
    (available.some((place) => !state.places.includes(place)) ? 1 : 0) +
    (state.expired ? 1 : 0) +
    (state.soon ? 1 : 0);
  const tipRow = tip ? rowsByKey.get(tip.itemKey) : undefined;
  const slot: SlotContext = { items: data.items, prices: data.prices, tip, events: slotEvents };
  const viewNav = (
    <nav className="segmented" aria-label="Présentation">
      {(["items", "characters"] as const).map((view) => (
        <a
          key={view}
          href={writeInventoryState({ ...state, view }) || "?"}
          aria-current={state.view === view ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            update({ view });
          }}
        >
          {view === "items" ? "Tous les objets" : "Sac par sac"}
        </a>
      ))}
    </nav>
  );

  return (
    <div className="mt-6 space-y-5">
      <div className="space-y-2.5">
        <div className="inventory-search" role="search">
          <svg className="search-glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.6-3.6" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            placeholder="Chercher un objet : nom ou n°"
            aria-label="Rechercher un objet par son nom ou son identifiant"
            aria-keyshortcuts="/"
            maxLength={80}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={state.query}
            onChange={(event) => update({ query: event.target.value })}
          />
          <span className="search-end">
            {state.query !== "" ? (
              <button
                type="button"
                className="search-clear"
                aria-label="Effacer la recherche"
                onClick={() => {
                  update({ query: "" });
                  searchRef.current?.focus();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            ) : (
              <kbd className="hidden sm:inline-grid" title="Touche / : aller à la recherche">
                /
              </kbd>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
          <p className="text-sm text-muted" role="status">
            {rows.length === 0
              ? "Aucun objet ne correspond."
              : `${plural(rows.length, "objet")} différent${rows.length > 1 ? "s" : ""}, ${plural(total, "exemplaire")}`}
            {rows.length > 0 && data.market && (
              <>
                {" · "}
                <ValueEstimate copper={worth.value} unpriced={worth.unpriced} />
              </>
            )}
          </p>
          {filtered && (
            <button type="button" className="text-xs text-gold hover:underline" onClick={() => update({ ...DEFAULT_STATE, sort: state.sort })}>
              Effacer les filtres
            </button>
          )}
        </div>
      </div>

      {/* Téléphone : les filtres se replient derrière un bouton, la recherche et les cases restent en tête. */}
      <div className="flex items-center gap-2 sm:hidden">
        <button type="button" className="button" aria-expanded={filtersOpen} aria-controls="inventory-filters" onClick={() => setFiltersOpen((open) => !open)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          Filtres{activeFilters > 0 ? ` · ${activeFilters}` : ""}
        </button>
        <span className="flex-1" />
        {viewNav}
      </div>

      <div id="inventory-filters" className={`space-y-3 ${filtersOpen ? "" : "hidden sm:block"}`}>
        <div className="flex flex-wrap items-center gap-2">
          {accounts.length > 1 && (
            <select
              className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
              aria-label="Filtrer par compte"
              value={state.account}
              onChange={(event) => {
                const account = event.target.value;
                const keep = state.character !== "" && account !== "" && String(characters.get(Number(state.character))?.account.id) === account;
                const character = keep || account === "" ? state.character : "";
                update({ account, character, view: character === state.character ? state.view : defaultView(character) });
              }}
            >
              <option value="">Tous les comptes</option>
              {accounts.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <select
            className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
            aria-label="Filtrer par personnage"
            value={state.character}
            onChange={(event) => update({ character: event.target.value, view: defaultView(event.target.value) })}
          >
            <option value="">Tous les personnages</option>
            {characterOptions.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} ({character.realm}
                {state.account === "" && accounts.length > 1 ? `, ${character.account.label}` : ""})
              </option>
            ))}
          </select>
          <select
            className="field min-w-36 flex-1 sm:flex-none sm:w-auto"
            aria-label="Qualité minimale"
            value={state.minQuality}
            onChange={(event) => update({ minQuality: event.target.value })}
          >
            <option value="">Toutes qualités</option>
            {QUALITY_LABELS.slice(1, 6).map((label, index) => (
              <option key={label} value={index + 1}>
                {label} et mieux
              </option>
            ))}
          </select>
          <span className="hidden flex-1 sm:block" />
          <div className="hidden sm:block">{viewNav}</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {available.map((place) => (
            <button key={place} type="button" className="button" aria-pressed={state.places.includes(place)} onClick={() => togglePlace(place)}>
              {PLACE_LABELS[place]}
            </button>
          ))}
          {(hasSoon || state.soon) && (
            <button
              type="button"
              className="button"
              aria-pressed={state.soon}
              title="Seulement les courriers et les ventes qui expirent dans les trois jours"
              onClick={() => update({ soon: !state.soon })}
            >
              Bientôt échus
            </button>
          )}
          {hasExpired && (
            <button
              type="button"
              className="button"
              aria-pressed={state.expired}
              title="Inclure les courriers et les ventes dont l'échéance est passée depuis le relevé"
              onClick={() => update({ expired: !state.expired })}
            >
              Échus
            </button>
          )}
          <span className="flex-1" />
          {rows.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Trier par
              <select className="field w-auto" value={state.sort} onChange={(event) => update({ sort: event.target.value as InventorySort })}>
                {(Object.keys(SORT_LABELS) as InventorySort[]).map((sort) => (
                  <option key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {!available.includes("mail") && data.guilds.length === 0 && (
        <p className="text-xs text-muted">
          Courrier, enchères en cours et banques de guilde s&apos;ajoutent avec l&apos;addon Baganator et l&apos;agent 0.8.0 ou plus récent.
        </p>
      )}

      {state.view === "items" ? (
        rows.length > 0 && (
          <section className="bag-window p-3 sm:p-4" aria-label="Objets">
            <ul className="bag-grid" data-size="lg">
              {rows.slice(0, limit).map((row) => (
                <li key={row.itemKey}>
                  <ItemSlot
                    info={data.items[row.itemKey]}
                    itemKey={row.itemKey}
                    slotId={`all:${row.itemKey}`}
                    quantity={row.total}
                    flag={rowFlag(row.holdings, now)}
                    tip={tip}
                    events={slotEvents}
                  />
                </li>
              ))}
            </ul>
            {rows.length > limit && (
              <div className="mt-4 text-center">
                <button type="button" className="button" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                  Afficher {Math.min(PAGE_SIZE, rows.length - limit)} objets de plus ({formatInteger(rows.length - limit)} restants)
                </button>
              </div>
            )}
          </section>
        )
      ) : (
        <BagWindows holdings={holdings} data={data} sort={state.sort} now={now} slot={slot} />
      )}

      {tip && tipRow && <ItemTooltip row={tipRow} data={data} tip={tip} characters={characters} guilds={guilds} now={now} onClose={closeTip} />}

      {data.market && rows.length > 0 && (
        <p className="text-xs text-faint">
          Valeurs estimées à l&apos;hôtel des ventes {data.market.label} : médiane des prix les plus bas relevés par Auctionator sur les quatorze
          derniers jours, commission non déduite. Les objets jamais vus en vente n&apos;ont pas de prix.
        </p>
      )}
    </div>
  );
}

/** Bulle d'objet : nom à la couleur de la qualité, total et valeur, puis chaque détenteur. */
function ItemTooltip({
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
function BagWindows({ holdings, data, sort, now, slot }: { holdings: Holding[]; data: InventoryData; sort: InventorySort; now: Date; slot: SlotContext }) {
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
