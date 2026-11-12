"use client";

import { getImageProps } from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InventoryCharacter, InventoryData, InventoryGuild, InventoryItemInfo } from "@/lib/dashboard/inventory";
import {
  DEFAULT_STATE,
  defaultView,
  groupByCharacter,
  groupByGuild,
  groupByItem,
  holdingNote,
  type Holding,
  type InventoryPlace,
  type InventorySort,
  type InventoryState,
  type ItemRow,
  PLACE_LABELS,
  PLACES,
  type PlaceGroup,
  readInventoryState,
  selectHoldings,
  slotCount,
  sortHoldings,
  writeInventoryState,
} from "@/lib/dashboard/inventory-view";
import { classKey, formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { itemIconUrl } from "@/lib/wow/icons";
import { ClassAvatar, EmptyState, Money } from "./ui";

/** Cases affichées d'un coup dans la grille des objets ; le bouton du bas en ajoute autant. */
const PAGE_SIZE = 160;
/** Détenteurs listés dans la bulle d'un objet ; les suivants sont comptés. */
const TOOLTIP_HOLDERS = 12;
const TOOLTIP_ID = "inventory-tooltip";

const SORT_LABELS: Record<InventorySort, string> = { total: "Quantité", name: "Nom", quality: "Qualité" };

const plural = (count: number, word: string) => `${formatInteger(count)} ${word}${count > 1 ? "s" : ""}`;
const itemName = (info: InventoryItemInfo | undefined, itemKey: string) => info?.name ?? `Objet n° ${itemKey}`;

/**
 * Case dont la bulle est ouverte : survolée ou atteinte au clavier, ou épinglée d'un clic. slotId
 * distingue deux cases du même objet (sacs et banque d'un personnage).
 */
type Tip = { slotId: string; itemKey: string; anchor: HTMLElement; pinned: boolean };

type SlotEvents = (
  slotId: string,
  itemKey: string,
) => {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
};

/** Ce qu'il faut à chaque case : la description des objets, la bulle ouverte et ses gestionnaires. */
type SlotContext = { items: InventoryData["items"]; tip: Tip | null; events: SlotEvents };

/** Tous les inventaires : sacs, banque, courrier, enchères et banques de guilde, en cases comme en jeu. */
export function InventoryBrowser({ data, now: nowIso }: { data: InventoryData; now: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const searchParams = useSearchParams();
  const [state, setState] = useState<InventoryState>(() => readInventoryState(searchParams));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [tip, setTip] = useState<Tip | null>(null);
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
    setTip(null);
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

  const holdings = useMemo(() => selectHoldings(data, state, now), [data, state, now]);
  const rows = useMemo(() => groupByItem(holdings, data.items, state.sort), [holdings, data.items, state.sort]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.itemKey, row])), [rows]);
  const total = rows.reduce((sum, row) => sum + row.total, 0);

  // Survol et clavier ouvrent la bulle sans écraser une bulle épinglée ; un clic l'épingle ou la referme.
  const slotEvents = useCallback<SlotEvents>(
    (slotId, itemKey) => ({
      onPointerEnter: (event) => {
        if (event.pointerType !== "mouse") return;
        const anchor = event.currentTarget;
        setTip((current) => (current?.pinned ? current : { slotId, itemKey, anchor, pinned: false }));
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== "mouse") return;
        setTip((current) => (current?.pinned ? current : null));
      },
      // Le focus donné par un clic n'ouvre rien : le clic s'en charge ; seul le clavier compte ici.
      onFocus: (event) => {
        const anchor = event.currentTarget;
        if (!anchor.matches(":focus-visible")) return;
        setTip((current) => (current?.pinned ? current : { slotId, itemKey, anchor, pinned: false }));
      },
      onBlur: () => setTip((current) => (current?.pinned ? current : null)),
      onClick: (event) => {
        const anchor = event.currentTarget;
        setTip((current) => (current?.pinned && current.slotId === slotId ? null : { slotId, itemKey, anchor, pinned: true }));
      },
    }),
    [],
  );
  const closeTip = useCallback(() => setTip(null), []);

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
    setTip(null);
  };
  const filtered =
    state.query.trim() !== "" || state.account !== "" || state.character !== "" || state.minQuality !== "" || available.some((place) => !state.places.includes(place));
  const activeFilters =
    [state.account, state.character, state.minQuality].filter((value) => value !== "").length +
    (available.some((place) => !state.places.includes(place)) ? 1 : 0) +
    (state.expired ? 1 : 0);
  const tipRow = tip ? rowsByKey.get(tip.itemKey) : undefined;
  const slot: SlotContext = { items: data.items, tip, events: slotEvents };
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
                    slot={slot}
                    slotId={`all:${row.itemKey}`}
                    itemKey={row.itemKey}
                    quantity={row.total}
                    expired={row.holdings.every((holding) => holding.kind === "character" && holdingNote(holding.expiresAt, now)?.warn === true)}
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

      {tip && tipRow && (
        <ItemTooltip
          row={tipRow}
          info={data.items[tipRow.itemKey]}
          tip={tip}
          characters={characters}
          guilds={guilds}
          now={now}
          onClose={closeTip}
        />
      )}
    </div>
  );
}

/** Case d'objet : icône, liseré de qualité, quantité au coin ; la bulle donne le détail. */
function ItemSlot({ slot, slotId, itemKey, quantity, expired }: { slot: SlotContext; slotId: string; itemKey: string; quantity: number; expired?: boolean }) {
  const open = slot.tip?.slotId === slotId;
  return (
    <MemoSlot
      items={slot.items}
      events={slot.events}
      slotId={slotId}
      itemKey={itemKey}
      quantity={quantity}
      expired={expired === true}
      open={open}
      pinned={open && slot.tip?.pinned === true}
    />
  );
}

// Mémorisée : survoler une case ne redessine que la case quittée et la case atteinte, pas la grille.
const MemoSlot = memo(function SlotButton({
  items,
  events,
  slotId,
  itemKey,
  quantity,
  expired,
  open,
  pinned,
}: {
  items: InventoryData["items"];
  events: SlotEvents;
  slotId: string;
  itemKey: string;
  quantity: number;
  expired: boolean;
  open: boolean;
  pinned: boolean;
}) {
  const info = items[itemKey];
  return (
    <button
      type="button"
      className="item-slot"
      data-quality={info?.quality ?? undefined}
      data-expired={expired || undefined}
      aria-label={`${itemName(info, itemKey)}, ${formatInteger(quantity)}${expired ? ", échu" : ""}`}
      aria-describedby={open ? TOOLTIP_ID : undefined}
      aria-expanded={pinned}
      {...events(slotId, itemKey)}
    >
      <ItemIcon name={info?.icon ?? null} />
      {expired && <span className="item-flag">échu</span>}
      {quantity > 1 && <span className="item-count">{slotCount(quantity)}</span>}
    </button>
  );
});

/** Icône servie par l'optimiseur d'images ; une icône absente du CDN (propre à WoW Forever) devient le point d'interrogation du jeu. */
function ItemIcon({ name }: { name: string | null }) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  // Une erreur survenue avant l'hydratation n'a déclenché aucun gestionnaire : elle se lit sur l'image.
  useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, []);
  const { props } = getImageProps({ src: itemIconUrl(failed ? null : name), alt: "", width: 56, height: 56 });
  // eslint-disable-next-line @next/next/no-img-element -- getImageProps fournit déjà src et srcSet optimisés
  return <img {...props} ref={ref} alt="" style={undefined} draggable={false} onError={failed ? undefined : () => setFailed(true)} />;
}

/** Place la bulle à droite de la case, sinon à gauche, sinon dessous ou dessus, toujours dans la fenêtre. */
function placeTooltip(tooltip: HTMLElement, anchor: HTMLElement) {
  const margin = 8;
  const gap = 10;
  const box = anchor.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  let left = box.right + gap;
  let top = box.top;
  if (left + width > viewportWidth - margin) left = box.left - gap - width;
  if (left < margin) {
    left = Math.min(Math.max(margin, box.left + box.width / 2 - width / 2), viewportWidth - margin - width);
    top = box.bottom + gap;
    if (top + height > viewportHeight - margin) top = box.top - gap - height;
  }
  top = Math.min(Math.max(margin, top), viewportHeight - margin - height);
  // Propriétés posées par le DOM, pas d'attribut style : la CSP refuse les styles en ligne.
  tooltip.style.left = `${Math.round(Math.max(margin, left))}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.dataset.placed = "";
}

/** Bulle d'objet à la manière du jeu : nom à la couleur de la qualité, total, puis chaque détenteur. */
function ItemTooltip({
  row,
  info,
  tip,
  characters,
  guilds,
  now,
  onClose,
}: {
  row: ItemRow;
  info: InventoryItemInfo | undefined;
  tip: Tip;
  characters: Map<number, InventoryCharacter>;
  guilds: Map<number, InventoryGuild>;
  now: Date;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Fermée depuis l'intérieur de la bulle (bouton, lien atteint au clavier) : le focus revient à la case.
  const close = useCallback(() => {
    const focusInside = ref.current?.contains(document.activeElement) === true;
    onClose();
    if (focusInside && tip.anchor.isConnected) tip.anchor.focus({ preventScroll: true });
  }, [onClose, tip]);

  useLayoutEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    const place = () => {
      if (!tip.anchor.isConnected) return onClose();
      placeTooltip(tooltip, tip.anchor);
    };
    place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [tip, row, onClose]);

  // Échap referme toute bulle ; une bulle épinglée se referme aussi d'un clic ailleurs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || tip.anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    if (tip.pinned) document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [tip, onClose, close]);

  const shown = row.holdings.slice(0, TOOLTIP_HOLDERS);
  const hidden = row.holdings.length - shown.length;
  const itemId = row.itemKey.split(":")[0];

  return createPortal(
    <div ref={ref} id={TOOLTIP_ID} role="tooltip" className="game-tooltip" data-quality={info?.quality ?? undefined} data-pinned={tip.pinned || undefined}>
      <div className="flex items-start justify-between gap-4">
        <p className="tooltip-name">{itemName(info, row.itemKey)}</p>
        {tip.pinned && (
          <button type="button" className="-mr-1 -mt-0.5 rounded px-1 text-[#8f9bb8] hover:text-white" aria-label="Fermer" onClick={close}>
            ×
          </button>
        )}
      </div>
      <p className="text-[0.72rem] text-[#8f9bb8]">
        {info?.quality == null ? "" : `${QUALITY_LABELS[info.quality]} · `}objet n° {itemId}
      </p>
      <div className="tooltip-rule" />
      <p className="flex items-baseline justify-between gap-6">
        <span className="text-[#ffd100]">Total</span>
        <span className="font-semibold tabular-nums">{formatInteger(row.total)}</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {shown.map((holding) => (
          <TooltipHolder key={holdingKey(holding)} holding={holding} characters={characters} guilds={guilds} now={now} />
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-[0.72rem] text-[#8f9bb8]">
          et {formatInteger(hidden)} autre{hidden > 1 ? "s" : ""} détenteur{hidden > 1 ? "s" : ""}
        </p>
      )}
      {!tip.pinned && <p className="tooltip-hint">Clic : garder la bulle ouverte</p>}
    </div>,
    document.body,
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
            return (
              <section key={character.id} className="bag-window p-3 sm:p-4" aria-labelledby={`inventory-character-${character.id}`} data-class={classKey(character.class)}>
                <header className="mb-3 flex items-center gap-3">
                  <ClassAvatar name={character.name} classToken={character.class} size="sm" level={character.level} />
                  <div className="min-w-0">
                    <h2 id={`inventory-character-${character.id}`} className="bag-title truncate text-lg font-semibold">
                      <Link href={`/characters/${character.id}`} className="class-text hover:underline">
                        {character.name}
                      </Link>
                    </h2>
                    <p className="truncate text-xs text-muted">
                      {character.realm} · {character.account.label}
                    </p>
                  </div>
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
            {shownGuilds.map((guild) => (
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
                  <span className="text-sm">
                    <Money copper={guild.moneyCopper} />
                  </span>
                </header>
                {byGuild.get(guild.id)!.map((group) => (
                  <BagSection key={group.tab} scope={`g${guild.id}-${group.tab}`} title={tabLabel(guild, group.tab ?? 0)} seen={guild.seenAt} group={group} sort={sort} now={now} large={single} slot={slot} />
                ))}
              </section>
            ))}
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
  const sorted = sortHoldings(group.holdings, slot.items, sort);
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
              slot={slot}
              slotId={`${scope}:${holding.itemKey}`}
              itemKey={holding.itemKey}
              quantity={holding.quantity}
              expired={holding.kind === "character" && holdingNote(holding.expiresAt, now)?.warn === true}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
