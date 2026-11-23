"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { groupByAccount } from "@/lib/dashboard/account-groups";
import { type Filters, type GoalState, naturalDescending, NO_FILTERS, readBrowserState, type SortKey, writeBrowserState } from "@/lib/dashboard/browser-state";
import { collator, filterCharacters, sortCharacters } from "@/lib/dashboard/character-filter";
import type { CharacterListItem } from "@/lib/dashboard/queries";
import { COLLAPSED_COOKIE, parseCollapsed, parseView, prefCookie, readViewPrefs, VIEW_COOKIE, type CharacterView, type ViewPrefs } from "@/lib/dashboard/view-prefs";
import { accountArt } from "@/lib/wow/art";
import { classLabel } from "@/lib/wow/format";
import { ArtBackdrop } from "./art-backdrop";
import { CharacterCard, CharacterTable, type Ranks } from "./character-list-views";
import { FavoriteToggle } from "./favorite-toggle";
import { EmptyState, Money, StarIcon } from "./ui";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "level", label: "Niveau" },
  { key: "name", label: "Nom" },
  { key: "itemLevel", label: "Niveau d'objet" },
  { key: "money", label: "Or" },
  { key: "activity", label: "Dernière activité" },
  { key: "progress", label: "Progression du niveau" },
];

// Vue et comptes repliés vivent dans des cookies : le serveur les lit pour le premier rendu (prop
// `prefs`), le navigateur les relit ensuite lui-même. Un retour arrière, servi depuis le cache du
// routeur avec une prop d'avant, retrouve ainsi la dernière préférence choisie.
const prefListeners = new Set<() => void>();
function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

function writePref(name: string, value: string) {
  document.cookie = prefCookie(name, value, window.location.protocol === "https:");
  prefListeners.forEach((listener) => listener());
}

// Anciennes préférences, gardées dans le navigateur avant les cookies (site 0.31 et avant) : elles
// valent tant que le cookie manque, y sont recopiées puis effacées.
const LEGACY_VIEW_KEY = "altboard:view";
const LEGACY_COLLAPSED_KEY = "altboard:collapsed-accounts";
let legacyRead: ViewPrefs | undefined;

/** Lue une fois par chargement ; rien si le stockage est indisponible (navigation privée). */
function readLegacy(): ViewPrefs {
  if (legacyRead === undefined) {
    try {
      legacyRead = { view: parseView(window.localStorage.getItem(LEGACY_VIEW_KEY)), collapsed: parseCollapsed(window.localStorage.getItem(LEGACY_COLLAPSED_KEY)) };
    } catch {
      legacyRead = { view: null, collapsed: null };
    }
  }
  return legacyRead;
}

let snapshot: { cookies: string; prefs: ViewPrefs } | undefined;

/** Préférences côté navigateur ; même objet tant que les cookies ne changent pas. */
function clientPrefs(): ViewPrefs {
  const cookies = document.cookie;
  if (snapshot?.cookies !== cookies) {
    const jar = new Map(cookies.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
    const stored = readViewPrefs((name) => jar.get(name));
    const legacy = readLegacy();
    snapshot = { cookies, prefs: { view: stored.view ?? legacy.view, collapsed: stored.collapsed ?? legacy.collapsed } };
  }
  return snapshot.prefs;
}

function migrateLegacy() {
  const legacy = readLegacy();
  if (legacy.view === null && legacy.collapsed === null) return;
  // Un cookie déjà posé l'emporte : seul ce qui y manque est recopié.
  if (legacy.view && !document.cookie.includes(`${VIEW_COOKIE}=`)) writePref(VIEW_COOKIE, legacy.view);
  if (legacy.collapsed && !document.cookie.includes(`${COLLAPSED_COOKIE}=`)) writePref(COLLAPSED_COOKIE, legacy.collapsed.join(","));
  try {
    window.localStorage.removeItem(LEGACY_VIEW_KEY);
    window.localStorage.removeItem(LEGACY_COLLAPSED_KEY);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
}

const GOAL_FILTERS: (readonly [GoalState, string])[] = [
  ["open", "Objectifs en cours"],
  ["done", "Objectifs tous atteints"],
  ["none", "Sans objectif"],
];

/** Options dont la valeur et le libellé sont identiques. */
const same = (values: string[]) => values.map((value) => [value, value] as const);

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(collator.compare);
}

export function CharacterBrowser({
  characters,
  now,
  ranks = {},
  prefs = { view: null, collapsed: null },
}: {
  characters: CharacterListItem[];
  now: string;
  ranks?: Ranks;
  /** Préférences lues dans les cookies au rendu serveur. */
  prefs?: ViewPrefs;
}) {
  // Recherche, filtres, tri et favoris partent de l'adresse, puis y sont recopiés à chaque changement :
  // ouvrir une fiche puis revenir retrouve la liste telle qu'on l'a laissée.
  const searchParams = useSearchParams();
  const [initial] = useState(() => readBrowserState(searchParams));
  const [query, setQuery] = useState(initial.query);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [sort, setSort] = useState(initial.sort);
  const [favoritesOnly, setFavoritesOnly] = useState(initial.favoritesOnly);
  // Repliés à l'arrivée : la recherche suffit le plus souvent, et les personnages remontent d'autant.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Vue et comptes repliés : la valeur du serveur à l'hydratation, puis celle des cookies du navigateur.
  const stored = useSyncExternalStore(subscribePrefs, clientPrefs, () => prefs);
  const view: CharacterView = stored.view ?? "cards";
  const collapsed = useMemo(() => new Set(stored.collapsed ?? []), [stored.collapsed]);
  const reference = useMemo(() => new Date(now), [now]);

  const chooseView = (next: CharacterView) => writePref(VIEW_COOKIE, next);

  useEffect(migrateLegacy, []);

  const options = useMemo(
    () => ({
      accounts: [...new Map(characters.map((c) => [String(c.account.id), c.account.label])).entries()].sort((a, b) => collator.compare(a[1], b[1])),
      machines: [...new Map(characters.flatMap((c) => c.machines).map((m) => [String(m.id), m.label])).entries()].sort((a, b) => collator.compare(a[1], b[1])),
      realms: distinct(characters.map((c) => c.realm)),
      classes: distinct(characters.map((c) => c.class)).sort((a, b) => collator.compare(classLabel(a), classLabel(b))),
      races: distinct(characters.map((c) => c.race)),
      factions: distinct(characters.map((c) => c.faction)),
      professions: distinct(characters.flatMap((c) => c.professions.map((p) => p.name))),
    }),
    [characters],
  );

  const visible = useMemo(
    () => sortCharacters(filterCharacters(characters, { query, filters, favoritesOnly }), sort),
    [characters, favoritesOnly, filters, query, sort],
  );

  // replaceState plutôt que pushState : un filtre ne crée pas d'étape dans l'historique. Next.js
  // suit ces appels (useSearchParams) sans recharger la page.
  useEffect(() => {
    const search = writeBrowserState({ query, filters, sort, favoritesOnly }, window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [favoritesOnly, filters, query, sort]);

  const hasFavorites = useMemo(() => characters.some((c) => c.account.featured), [characters]);

  // Le tri choisi s'applique à l'intérieur de chaque bloc.
  const groups = useMemo(() => groupByAccount(visible, collator.compare), [visible]);
  const toggleAccount = (id: number) => {
    const next = new Set(collapsed);
    if (!next.delete(String(id))) next.add(String(id));
    writePref(COLLAPSED_COOKIE, [...next].join(","));
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const filtered = query.trim() !== "" || activeFilters > 0 || favoritesOnly;
  const setFilter = (key: keyof Filters) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setFilters((current) => ({ ...current, [key]: event.target.value }));

  if (characters.length === 0) {
    return (
      <EmptyState title="Aucun personnage pour l'instant">
        Lancez <code className="rounded bg-white/10 px-1.5 py-0.5 text-text">AltBoardSync.exe sync</code> sur un PC où World of Warcraft et
        l&apos;addon AltBoard sont installés. Les étapes sont détaillées dans la page{" "}
        <Link href="/machines" className="text-gold underline underline-offset-2">
          Machines
        </Link>
        .
      </EmptyState>
    );
  }

  return (
    <section aria-label="Personnages">
      <div className="panel mb-5 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            className="field min-w-56 flex-1"
            placeholder="Rechercher un personnage…"
            aria-label="Rechercher par nom, classe, race, royaume, métier ou compte"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* Doré quand un filtre agit, même replié : un filtre oublié ne passe pas inaperçu. */}
          <button
            type="button"
            className="button"
            aria-expanded={filtersOpen}
            aria-controls="character-filters"
            data-active={activeFilters > 0 || undefined}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filtres{activeFilters > 0 && ` (${activeFilters})`}
            <span aria-hidden="true">{filtersOpen ? "▴" : "▾"}</span>
          </button>
          {/* Affiché dès qu'un compte est favori, ou tant que le filtre agit (adresse partagée). Sur
              téléphone l'étoile seule laisse sa place au tri ; le libellé reste lu par les lecteurs d'écran. */}
          {(hasFavorites || favoritesOnly) && (
            <button
              type="button"
              className="button"
              aria-pressed={favoritesOnly}
              title="N'afficher que les comptes favoris"
              onClick={() => setFavoritesOnly((only) => !only)}
            >
              <StarIcon filled={favoritesOnly} size={15} />
              <span className="sr-only sm:not-sr-only">Favoris</span>
            </button>
          )}
          {/* Sur téléphone le tri partage la rangée des filtres : son libellé visible cède la place. */}
          <label className="flex min-w-32 flex-1 items-center gap-2 text-xs text-muted sm:flex-none">
            <span className="sr-only whitespace-nowrap sm:not-sr-only">Trier par</span>
            <select
              className="field min-w-0 flex-1 sm:w-auto sm:flex-none"
              value={sort.key}
              onChange={(event) => setSort({ key: event.target.value as SortKey, descending: naturalDescending(event.target.value as SortKey) })}
            >
              {SORTS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button"
            onClick={() => setSort((current) => ({ ...current, descending: !current.descending }))}
            aria-label={sort.descending ? "Tri décroissant, passer en croissant" : "Tri croissant, passer en décroissant"}
            title={sort.descending ? "Décroissant" : "Croissant"}
          >
            {sort.descending ? "↓" : "↑"}
          </button>
          <div className="flex gap-1" role="group" aria-label="Mode d'affichage">
            <button type="button" className="button" aria-pressed={view === "cards"} onClick={() => chooseView("cards")}>
              ▦ Cartes
            </button>
            <button type="button" className="button" aria-pressed={view === "table"} onClick={() => chooseView("table")}>
              ☰ Tableau
            </button>
          </div>
        </div>

        <div id="character-filters" className={filtersOpen ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-10" : "hidden"}>
          <FilterSelect label="Compte" value={filters.account} onChange={setFilter("account")} options={options.accounts} />
          <FilterSelect label="Royaume" value={filters.realm} onChange={setFilter("realm")} options={same(options.realms)} />
          <FilterSelect
            label="Classe"
            value={filters.classToken}
            onChange={setFilter("classToken")}
            options={options.classes.map((v) => [v, classLabel(v)] as const)}
          />
          <FilterSelect label="Race" value={filters.race} onChange={setFilter("race")} options={same(options.races)} />
          <FilterSelect label="Faction" value={filters.faction} onChange={setFilter("faction")} options={same(options.factions)} />
          <FilterSelect
            label="Métier"
            value={filters.profession}
            onChange={setFilter("profession")}
            options={same(options.professions)}
          />
          <FilterSelect label="PC" value={filters.machine} onChange={setFilter("machine")} options={options.machines} />
          <FilterSelect label="Objectifs" value={filters.goals} onChange={setFilter("goals")} options={[...GOAL_FILTERS]} />
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className="field"
            placeholder="Niveau min."
            aria-label="Niveau minimum"
            value={filters.minLevel}
            onChange={setFilter("minLevel")}
          />
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className="field"
            placeholder="Niveau max."
            aria-label="Niveau maximum"
            value={filters.maxLevel}
            onChange={setFilter("maxLevel")}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <p aria-live="polite">
            {visible.length === characters.length
              ? `${characters.length} personnage${characters.length > 1 ? "s" : ""}`
              : `${visible.length} sur ${characters.length} personnages`}
          </p>
          {filtered && (
            <button
              type="button"
              className="text-gold underline underline-offset-2"
              onClick={() => {
                setQuery("");
                setFilters(NO_FILTERS);
                setFavoritesOnly(false);
              }}
            >
              Tout afficher
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="Aucun personnage ne correspond">Modifiez la recherche ou les filtres.</EmptyState>
      ) : (
        <div className="space-y-8">
          {groups.map(({ account, members, totalCopper, topLevel }, index) => {
            const folded = collapsed.has(String(account.id));
            // Les comptes favoris passent devant ; un intertitre sépare les autres.
            const firstOther = !account.featured && index > 0 && groups[index - 1].account.featured;
            return (
              <section key={account.id} aria-label={account.label}>
                {firstOther && (
                  <p className="divider-label mb-5" aria-hidden="true">
                    Autres comptes
                  </p>
                )}
                <div className="account-banner" data-featured={account.featured || undefined} data-art="">
                  <ArtBackdrop art={accountArt(account.id)} className="account-art" sizes="(min-width: 1500px) 1500px, 100vw" />
                  <div className="flex min-w-0 items-center gap-1.5">
                    <h2 className="min-w-0">
                      <button
                        type="button"
                        className="flex min-w-0 max-w-full items-center gap-2.5 text-left"
                        aria-expanded={!folded}
                        aria-controls={`account-${account.id}`}
                        onClick={() => toggleAccount(account.id)}
                      >
                        <span aria-hidden="true" className="w-3 flex-none text-sm text-muted">
                          {folded ? "▸" : "▾"}
                        </span>
                        <span className="account-name truncate">{account.label}</span>
                        {account.featured && <span className="sr-only"> (compte favori)</span>}
                      </button>
                    </h2>
                    <FavoriteToggle accountId={account.id} accountLabel={account.label} favorite={account.featured} compact />
                  </div>
                  <ul className="flex flex-wrap items-center gap-1.5">
                    <li className="stat-chip">
                      <strong>{members.length}</strong> personnage{members.length > 1 ? "s" : ""}
                    </li>
                    {topLevel !== null && (
                      <li className="stat-chip">
                        Niveau max. <strong>{topLevel}</strong>
                      </li>
                    )}
                    {totalCopper !== null && (
                      <li className="stat-chip">
                        Or <Money copper={totalCopper} />
                      </li>
                    )}
                  </ul>
                </div>
                <div id={`account-${account.id}`} hidden={folded}>
                  {view === "cards" ? (
                    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {members.map((character) => (
                        <li key={character.id}>
                          <CharacterCard character={character} now={reference} rank={ranks[character.id]} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <CharacterTable characters={members} now={reference} ranks={ranks} />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  options: (readonly [string, string])[];
}) {
  return (
    <select className="field" aria-label={`Filtrer par ${label.toLowerCase()}`} value={value} onChange={onChange}>
      <option value="">{label}</option>
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue}>
          {optionLabel}
        </option>
      ))}
    </select>
  );
}
