"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { groupByAccount } from "@/lib/dashboard/account-groups";
import type { CharacterListItem } from "@/lib/dashboard/queries";
import { classKey, classLabel, formatDateTime, formatItemLevel, formatRelative, progressPercent } from "@/lib/wow/format";
import { ClassAvatar, EmptyState, FactionBadge, Meter, Money, ProfessionIcon, SectionTitle } from "./ui";

type SortKey = "name" | "level" | "itemLevel" | "money" | "activity" | "progress";
type View = "cards" | "table";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "level", label: "Niveau" },
  { key: "name", label: "Nom" },
  { key: "itemLevel", label: "Niveau d'objet" },
  { key: "money", label: "Or" },
  { key: "activity", label: "Dernière activité" },
  { key: "progress", label: "Progression du niveau" },
];

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Minuscules sans accents : « elodie » trouve « Élodie ». */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Préférence mémorisée dans le navigateur ; le rendu serveur part toujours de la valeur par défaut.
function browserPreference(key: string) {
  const listeners = new Set<() => void>();
  // Stockage indisponible (navigation privée) : le choix vaut pour la page seulement.
  let fallback: string | null = null;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    read(): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return fallback;
      }
    },
    write(value: string) {
      fallback = value;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Voir fallback.
      }
      listeners.forEach((listener) => listener());
    },
  };
}
const viewPreference = browserPreference("altboard:view");
/** Identifiants des comptes repliés, séparés par des virgules. */
const collapsedPreference = browserPreference("altboard:collapsed-accounts");
const serverPreference = () => null;

type Filters = {
  account: string;
  realm: string;
  classToken: string;
  race: string;
  faction: string;
  profession: string;
  machine: string;
  goals: string;
  minLevel: string;
  maxLevel: string;
};
const NO_FILTERS: Filters = { account: "", realm: "", classToken: "", race: "", faction: "", profession: "", machine: "", goals: "", minLevel: "", maxLevel: "" };

const GOAL_FILTERS = [
  ["open", "Objectifs en cours"],
  ["done", "Objectifs tous atteints"],
  ["none", "Sans objectif"],
] as const;

function goalState(goals: CharacterListItem["goals"]): (typeof GOAL_FILTERS)[number][0] {
  if (goals.total === 0) return "none";
  return goals.done < goals.total ? "open" : "done";
}

/** Options dont la valeur et le libellé sont identiques. */
const same = (values: string[]) => values.map((value) => [value, value] as const);

function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort(collator.compare);
}

function sortValue(character: CharacterListItem, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return character.name;
    case "level":
      return character.level;
    case "itemLevel":
      return character.itemLevel;
    case "money":
      return character.moneyCopper;
    case "activity":
      return Date.parse(character.sourceLastSeenAt);
    case "progress":
      return character.xp !== null && character.xpMax ? character.xp / character.xpMax : null;
  }
}

export function CharacterBrowser({ characters, now }: { characters: CharacterListItem[]; now: string }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "level", descending: true });
  // Repliés à l'arrivée : la recherche suffit le plus souvent, et les personnages remontent d'autant.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const view: View = useSyncExternalStore(viewPreference.subscribe, viewPreference.read, serverPreference) === "table" ? "table" : "cards";
  const collapsedIds = useSyncExternalStore(collapsedPreference.subscribe, collapsedPreference.read, serverPreference);
  const collapsed = useMemo(() => new Set(collapsedIds ? collapsedIds.split(",") : []), [collapsedIds]);
  const reference = useMemo(() => new Date(now), [now]);

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

  const visible = useMemo(() => {
    const needle = fold(query.trim());
    const minLevel = filters.minLevel === "" ? null : Number(filters.minLevel);
    const maxLevel = filters.maxLevel === "" ? null : Number(filters.maxLevel);

    const matching = characters.filter((c) => {
      if (filters.account && String(c.account.id) !== filters.account) return false;
      if (filters.realm && c.realm !== filters.realm) return false;
      if (filters.classToken && c.class !== filters.classToken) return false;
      if (filters.race && c.race !== filters.race) return false;
      if (filters.faction && c.faction !== filters.faction) return false;
      if (filters.profession && !c.professions.some((p) => p.name === filters.profession)) return false;
      if (filters.machine && !c.machines.some((m) => String(m.id) === filters.machine)) return false;
      if (filters.goals && goalState(c.goals) !== filters.goals) return false;
      if (minLevel !== null && (c.level === null || c.level < minLevel)) return false;
      if (maxLevel !== null && (c.level === null || c.level > maxLevel)) return false;
      if (!needle) return true;
      const haystack = [c.name, classLabel(c.class), c.race, c.realm, c.account.label, c.guild, ...c.professions.map((p) => p.name)];
      return haystack.some((value) => value && fold(value).includes(needle));
    });

    return matching.sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);
      // Les valeurs absentes vont toujours à la fin, quel que soit le sens du tri.
      if (left === null || right === null) return left === right ? collator.compare(a.name, b.name) : left === null ? 1 : -1;
      const order = typeof left === "string" ? collator.compare(left, right as string) : left - (right as number);
      return (sort.descending ? -order : order) || collator.compare(a.name, b.name);
    });
  }, [characters, filters, query, sort]);

  // Le tri choisi s'applique à l'intérieur de chaque bloc.
  const groups = useMemo(() => groupByAccount(visible, collator.compare), [visible]);
  const toggleAccount = (id: number) => {
    const next = new Set(collapsed);
    if (!next.delete(String(id))) next.add(String(id));
    collapsedPreference.write([...next].join(","));
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;
  const filtered = query.trim() !== "" || activeFilters > 0;
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
          {/* Sur téléphone le tri partage la rangée des filtres : son libellé visible cède la place. */}
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted sm:flex-none">
            <span className="sr-only whitespace-nowrap sm:not-sr-only">Trier par</span>
            <select
              className="field min-w-0 flex-1 sm:w-auto sm:flex-none"
              value={sort.key}
              onChange={(event) => setSort({ key: event.target.value as SortKey, descending: event.target.value !== "name" })}
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
            <button type="button" className="button" aria-pressed={view === "cards"} onClick={() => viewPreference.write("cards")}>
              ▦ Cartes
            </button>
            <button type="button" className="button" aria-pressed={view === "table"} onClick={() => viewPreference.write("table")}>
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
          {groups.map(({ account, members, totalCopper, topLevel }) => {
            const folded = collapsed.has(String(account.id));
            return (
              <section key={account.id} aria-label={account.label}>
                <SectionTitle
                  aside={
                    <p className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
                      <span>
                        {members.length} personnage{members.length > 1 ? "s" : ""}
                      </span>
                      {topLevel !== null && <span>Niveau le plus haut {topLevel}</span>}
                      {totalCopper !== null && (
                        <span>
                          Or total <Money copper={totalCopper} />
                        </span>
                      )}
                    </p>
                  }
                >
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    aria-expanded={!folded}
                    aria-controls={`account-${account.id}`}
                    onClick={() => toggleAccount(account.id)}
                  >
                    <span aria-hidden="true" className="w-3 text-sm text-muted">
                      {folded ? "▸" : "▾"}
                    </span>
                    {account.label}
                  </button>
                </SectionTitle>
                <div id={`account-${account.id}`} hidden={folded}>
                  {view === "cards" ? (
                    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {members.map((character) => (
                        <li key={character.id}>
                          <CharacterCard character={character} now={reference} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <CharacterTable characters={members} now={reference} />
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

function CharacterCard({ character, now }: { character: CharacterListItem; now: Date }) {
  const professions = [...character.professions].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).slice(0, 2);
  const others = character.professions.length - professions.length;

  return (
    <article className="panel character-card h-full p-5" data-class={classKey(character.class)}>
      <div className="flex items-start gap-4">
        <ClassAvatar name={character.name} classToken={character.class} level={character.level} />
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-lg font-bold leading-tight class-text" title={character.name}>
            <Link href={`/characters/${character.id}`} prefetch={false} className="after:absolute after:inset-0 after:z-10 focus-visible:outline-none">
              {character.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-text">
            {classLabel(character.class)}
            {character.level !== null && <span className="text-muted"> — Niveau {character.level}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{[character.race, character.realm].filter(Boolean).join(" • ")}</p>
        </div>
        <FactionBadge faction={character.faction} />
      </div>

      {character.xpMax !== null && character.xp !== null && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
            <span>Expérience</span>
            <span className="tabular-nums">{progressPercent(character.xp, character.xpMax)} %</span>
          </div>
          <Meter value={character.xp} max={character.xpMax} label="Progression du niveau" />
        </div>
      )}

      {character.goals.total > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
            <span>Objectifs</span>
            <span className="tabular-nums">
              {character.goals.done} / {character.goals.total}
            </span>
          </div>
          <Meter value={character.goals.done} max={character.goals.total} label={`Objectifs atteints de ${character.name}`} tone="gold" />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="eyebrow">Niveau d&apos;objet</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatItemLevel(character.itemLevel)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Or</dt>
          <dd className="mt-0.5">
            <Money copper={character.moneyCopper} />
          </dd>
        </div>
      </dl>

      {professions.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {professions.map((profession) => (
            <li key={profession.skillLine}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-text">
                  <ProfessionIcon skillLine={profession.skillLine} size={18} /> {profession.name}
                </span>
                <span className="tabular-nums text-muted">
                  {profession.rank ?? "—"} / {profession.maxRank ?? "—"}
                </span>
              </div>
              <Meter value={profession.rank} max={profession.maxRank} label={profession.name} tone="gold" />
            </li>
          ))}
          {others > 0 && <li className="text-xs text-faint">+ {others} autre{others > 1 ? "s" : ""} métier{others > 1 ? "s" : ""}</li>}
        </ul>
      )}

      <p
        className="mt-4 border-t border-line pt-3 text-xs text-muted"
        title={`Dernière donnée AltBoard connue : ${formatDateTime(character.sourceLastSeenAt)}`}
      >
        Vu en jeu {formatRelative(character.sourceLastSeenAt, now)}
      </p>
      {character.hidden && <p className="mt-2 text-xs text-faint">Masqué dans l&apos;addon</p>}
    </article>
  );
}

function CharacterTable({ characters, now }: { characters: CharacterListItem[]; now: Date }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table min-w-[1060px]">
        <thead>
          <tr>
            <th scope="col">Personnage</th>
            <th scope="col">Classe</th>
            <th scope="col" className="num">
              Niveau
            </th>
            <th scope="col" className="num">
              Niv. d&apos;objet
            </th>
            <th scope="col" className="num">
              Or
            </th>
            <th scope="col">Métiers</th>
            <th scope="col" className="num">
              Objectifs
            </th>
            <th scope="col">Royaume</th>
            <th scope="col">PC</th>
            <th scope="col">Vu en jeu</th>
          </tr>
        </thead>
        <tbody>
          {characters.map((character) => (
            <tr key={character.id} data-class={classKey(character.class)}>
              <td>
                <Link href={`/characters/${character.id}`} prefetch={false} className="flex items-center gap-3 font-semibold class-text hover:underline">
                  <ClassAvatar name={character.name} classToken={character.class} size="sm" />
                  <span className="max-w-56 truncate" title={character.name}>
                    {character.name}
                  </span>
                </Link>
              </td>
              <td>
                {classLabel(character.class)}
                {character.race && <span className="block text-xs text-muted">{character.race}</span>}
              </td>
              <td className="num">
                {character.level ?? "—"}
                {progressPercent(character.xp, character.xpMax) !== null && (
                  <span className="block text-xs text-muted">{progressPercent(character.xp, character.xpMax)} %</span>
                )}
              </td>
              <td className="num">{formatItemLevel(character.itemLevel)}</td>
              <td className="num">
                <Money copper={character.moneyCopper} />
              </td>
              <td className="text-xs text-muted">
                {character.professions.length === 0
                  ? "—"
                  : character.professions.map((p) => (
                      <span key={p.skillLine} className="mr-3 inline-block whitespace-nowrap">
                        <ProfessionIcon skillLine={p.skillLine} size={16} /> {p.name} {p.rank ?? "—"}/{p.maxRank ?? "—"}
                      </span>
                    ))}
              </td>
              <td className="num tabular-nums">{character.goals.total === 0 ? "—" : `${character.goals.done} / ${character.goals.total}`}</td>
              <td>
                {character.realm}
                <span className="block text-xs text-muted">{character.faction}</span>
              </td>
              <td className="text-muted">{character.machines.map((m) => m.label).join(", ") || "—"}</td>
              <td className="whitespace-nowrap text-muted" title={formatDateTime(character.sourceLastSeenAt)}>
                {formatRelative(character.sourceLastSeenAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
