"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryData } from "@/lib/dashboard/inventory";
import {
  categoryOf,
  categorySections,
  DEFAULT_STATE,
  gearFiltered,
  groupByItem,
  groupCategorySections,
  holdingsValue,
  isSoon,
  type InventoryPlace,
  type InventoryState,
  type ItemRow,
  PLACES,
  readInventoryState,
  selectHoldings,
  writeInventoryState,
} from "@/lib/dashboard/inventory-view";
import { formatInteger } from "@/lib/wow/format";
import { CLASSIC_CLASSES } from "@/lib/wow/gear";
import { itemIconUrl } from "@/lib/wow/icons";
import { categoryIcon, ITEM_CATEGORIES } from "@/lib/wow/item-categories";
import { InventoryFilters } from "./inventory-filters";
import { BagWindows, ItemGrid, ItemTooltip, plural, type SlotContext } from "./inventory-windows";
import { useItemTip, ValueEstimate } from "./item-slots";
import { SectionNav } from "./section-nav";
import { EmptyState, GameIcon } from "./ui";

/** Cases affichées d'un coup dans la grille des objets ; le bouton du bas en ajoute autant. */
const PAGE_SIZE = 160;

/** Tous les inventaires : sacs, banque, courrier, enchères et banques de guilde, en cases comme en jeu. */
export function InventoryBrowser({ data, now: nowIso, exportPath }: { data: InventoryData; now: string; exportPath: string }) {
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

  // Filtres d'équipement proposés dès qu'une armure ou une arme est connue.
  const hasGear = useMemo(() => Object.values(data.items).some((info) => info.gear !== undefined), [data.items]);
  // Équipements propres à WoW Forever dont aucune table publiée ne donne le niveau requis.
  const unknownLevels = useMemo(() => Object.values(data.items).filter((info) => info.gear && info.gear.requiredLevel === null).length, [data.items]);
  // Classes de Classic seulement : les règles de port ne connaissent pas les autres.
  const wearers = useMemo(() => data.characters.filter((character) => character.class !== null && CLASSIC_CLASSES.includes(character.class)), [data.characters]);
  const lostWearer = /^\d+$/.test(state.wearer) && !wearers.some((character) => String(character.id) === state.wearer);
  // Catégories proposées : celles des objets détenus, et celle choisie même sans objet.
  const categories = useMemo(() => {
    const present = new Set<string>();
    for (const entry of data.entries) present.add(categoryOf(data.items[entry.itemKey]));
    for (const guild of data.guilds) for (const tab of guild.tabs) for (const item of tab.items) present.add(categoryOf(data.items[item.itemKey]));
    return ITEM_CATEGORIES.filter((category) => present.has(category.value) || category.value === state.category);
  }, [data, state.category]);
  const holdings = useMemo(() => selectHoldings(data, state, now), [data, state, now]);
  const rows = useMemo(() => groupByItem(holdings, data.items, state.sort, data.prices), [holdings, data.items, state.sort, data.prices]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.itemKey, row])), [rows]);
  // Tri par catégorie : toutes les cases d'un coup (les icônes se chargent au défilement), une
  // section par catégorie et un sommaire pour sauter de l'une à l'autre.
  const byCategory = state.view === "items" && state.sort === "category";
  const sections = useMemo(() => (byCategory ? categorySections(rows, data.items) : []), [byCategory, rows, data.items]);
  const groups = useMemo(() => groupCategorySections(sections), [sections]);
  const sectionLinks = useMemo(
    () =>
      sections.map((section) => ({
        id: `categorie-${section.category}`,
        label: `${section.label} (${formatInteger(section.rows.length)})`,
        icon: itemIconUrl(categoryIcon(section.category)),
      })),
    [sections],
  );
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const worth = useMemo(() => holdingsValue(holdings, data.prices, now), [holdings, data.prices, now]);
  // Valeur de chaque catégorie et de chaque groupe, calculée une fois par filtre, pas à chaque survol.
  const groupWorths = useMemo(
    () =>
      groups.map((group) => ({
        group: holdingsValue(group.sections.flatMap((section) => section.rows.flatMap((row) => row.holdings)), data.prices, now),
        sections: group.sections.map((section) => holdingsValue(section.rows.flatMap((row) => row.holdings), data.prices, now)),
      })),
    [groups, data.prices, now],
  );
  // Même tableau d'un rendu à l'autre : la grille mémoïsée ne se redessine pas au survol.
  const visibleRows = useMemo(() => rows.slice(0, limit), [rows, limit]);

  if (data.characters.length === 0) {
    return (
      <EmptyState title="Aucun personnage synchronisé" action={{ href: "/machines#ajouter-un-pc", label: "Ajouter un PC" }}>
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
    state.category !== "" ||
    state.soon ||
    gearFiltered(state) ||
    available.some((place) => !state.places.includes(place));
  const activeFilters =
    [state.account, state.character, state.minQuality, state.category].filter((value) => value !== "").length +
    (available.some((place) => !state.places.includes(place)) ? 1 : 0) +
    (state.expired ? 1 : 0) +
    (state.soon ? 1 : 0) +
    [state.gearType, state.gearSlot, state.minLevel + state.maxLevel, state.wearer].filter((value) => value !== "").length;
  const tipRow = tip ? rowsByKey.get(tip.itemKey) : undefined;
  const slot: SlotContext = { items: data.items, prices: data.prices, tip, events: slotEvents };
  // Seule la grille qui contient la case survolée reçoit la bulle : les autres, mémoïsées, ne se
  // redessinent pas à chaque survol.
  const tipIn = (list: readonly ItemRow[]) => (tip && tip.slotId === `all:${tip.itemKey}` && list.some((row) => row.itemKey === tip.itemKey) ? tip : null);
  const itemGrid = (list: ItemRow[]) => <ItemGrid rows={list} items={data.items} now={now} tip={tipIn(list)} events={slotEvents} />;
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
          {rows.length > 0 && (
            // La vue affichée, filtres et tri compris : le serveur relit les mêmes paramètres.
            <a className="text-xs text-gold hover:underline" href={`${exportPath}${writeInventoryState(state)}`} download>
              Exporter la vue (Excel)
            </a>
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

      <InventoryFilters
        state={state}
        update={update}
        togglePlace={togglePlace}
        filtersOpen={filtersOpen}
        viewNav={viewNav}
        accounts={accounts}
        characters={characters}
        characterOptions={characterOptions}
        categories={categories}
        hasGear={hasGear}
        wearers={wearers}
        lostWearer={lostWearer}
        available={available}
        hasSoon={hasSoon}
        hasExpired={hasExpired}
        sortable={rows.length > 1}
      />

      {!available.includes("mail") && data.guilds.length === 0 && (
        <p className="text-xs text-muted">
          Courrier, enchères en cours et banques de guilde s&apos;ajoutent avec l&apos;addon Baganator et l&apos;agent 0.8.0 ou plus récent.
        </p>
      )}

      {byCategory ? (
        rows.length > 0 && (
          // Un lien du sommaire rouvre la catégorie repliée qu'il vise.
          <div
            className="space-y-4"
            onClickCapture={(event) => {
              const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#categorie-"]');
              const target = link ? document.getElementById(link.hash.slice(1)) : null;
              target?.closest("details")?.setAttribute("open", "");
            }}
          >
            {sections.length > 1 && <SectionNav label="Catégories" items={sectionLinks} />}
            {groups.map((group, groupIndex) => {
              const groupRows = group.sections.flatMap((section) => section.rows);
              const groupWorth = groupWorths[groupIndex].group;
              return (
                <section key={group.group} className="bag-window category-window" aria-label={group.group}>
                  <header className="category-window-head">
                    <h2 className="bag-title">{group.group}</h2>
                    <p>
                      {plural(groupRows.length, "objet")}
                      {data.market && (
                        <>
                          {" · "}
                          <ValueEstimate copper={groupWorth.value} unpriced={groupWorth.unpriced} />
                        </>
                      )}
                    </p>
                  </header>
                  {group.sections.map((section, sectionIndex) => {
                    const worth = groupWorths[groupIndex].sections[sectionIndex];
                    return (
                      <details key={section.category} className="category-section" open>
                        <summary id={`categorie-${section.category}`} className="category-summary">
                          <GameIcon src={itemIconUrl(categoryIcon(section.category))} size={32} className="category-icon" />
                          <span className="category-name">{section.label}</span>
                          <span className="category-count">{formatInteger(section.rows.length)}</span>
                          <span className="flex-1" />
                          {data.market && worth.value > 0 && (
                            <span className="hidden text-xs sm:inline">
                              <ValueEstimate copper={worth.value} unpriced={worth.unpriced} />
                            </span>
                          )}
                          <svg className="category-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </summary>
                        {itemGrid(section.rows)}
                      </details>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )
      ) : state.view === "items" ? (
        rows.length > 0 && (
          <section className="bag-window p-3 sm:p-4" aria-label="Objets">
            {itemGrid(visibleRows)}
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

      {(state.minLevel !== "" || state.maxLevel !== "") && unknownLevels > 0 && (
        <p className="text-xs text-faint">
          {unknownLevels > 1 ? `${formatInteger(unknownLevels)} équipements propres à WoW Forever n'ont` : "Un équipement propre à WoW Forever n'a"} pas de niveau requis
          connu : un filtre de niveau les écarte. Type, emplacement et classe s&apos;appliquent à eux normalement.
        </p>
      )}
      {data.market && rows.length > 0 && (
        <p className="text-xs text-faint">
          Valeurs estimées à l&apos;hôtel des ventes {data.market.label} : médiane des prix les plus bas relevés par Auctionator sur les quatorze
          derniers jours, commission non déduite. Les objets jamais vus en vente n&apos;ont pas de prix.
        </p>
      )}
    </div>
  );
}
