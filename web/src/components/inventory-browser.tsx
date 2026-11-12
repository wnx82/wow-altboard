"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { InventoryCharacter, InventoryData, InventoryGuild } from "@/lib/dashboard/inventory";
import {
  DEFAULT_STATE,
  groupByCharacter,
  groupByGuild,
  groupByItem,
  holdingNote,
  type Holding,
  type InventoryPlace,
  type InventorySort,
  type InventoryState,
  PLACE_LABELS,
  PLACES,
  type PlaceGroup,
  readInventoryState,
  selectHoldings,
  writeInventoryState,
} from "@/lib/dashboard/inventory-view";
import { classKey, formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";
import { EmptyState, Money } from "./ui";

const PAGE_SIZE = 50;

const SORT_LABELS: Record<InventorySort, string> = { total: "Quantité", name: "Nom", quality: "Qualité" };

const plural = (count: number, word: string) => `${formatInteger(count)} ${word}${count > 1 ? "s" : ""}`;

/** Tous les inventaires : sacs, banque, courrier, enchères et banques de guilde, par objet ou par personnage. */
export function InventoryBrowser({ data, now: nowIso }: { data: InventoryData; now: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const searchParams = useSearchParams();
  const [state, setState] = useState<InventoryState>(() => readInventoryState(searchParams));
  const [limit, setLimit] = useState(PAGE_SIZE);

  // replaceState plutôt que pushState : un filtre ne crée pas d'étape dans l'historique.
  useEffect(() => {
    const search = writeInventoryState(state, window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [state]);

  const update = (patch: Partial<InventoryState>) => {
    setState((current) => ({ ...current, ...patch }));
    setLimit(PAGE_SIZE);
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
  const total = rows.reduce((sum, row) => sum + row.total, 0);

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
  };
  const filtered =
    state.query.trim() !== "" || state.account !== "" || state.character !== "" || state.minQuality !== "" || available.some((place) => !state.places.includes(place));

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <input
          type="search"
          className="field w-full sm:w-auto sm:min-w-48 sm:flex-[2]"
          placeholder="Rechercher un objet : nom ou identifiant"
          aria-label="Rechercher un objet par son nom ou son identifiant"
          maxLength={80}
          value={state.query}
          onChange={(event) => update({ query: event.target.value })}
        />
        {accounts.length > 1 && (
          <select
            className="field min-w-36 flex-1"
            aria-label="Filtrer par compte"
            value={state.account}
            onChange={(event) => {
              const account = event.target.value;
              const keep = state.character !== "" && account !== "" && String(characters.get(Number(state.character))?.account.id) === account;
              update({ account, character: keep || account === "" ? state.character : "" });
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
        <select className="field min-w-36 flex-1" aria-label="Filtrer par personnage" value={state.character} onChange={(event) => update({ character: event.target.value })}>
          <option value="">Tous les personnages</option>
          {characterOptions.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name} ({character.realm}
              {state.account === "" && accounts.length > 1 ? `, ${character.account.label}` : ""})
            </option>
          ))}
        </select>
        <select className="field min-w-36 flex-1" aria-label="Qualité minimale" value={state.minQuality} onChange={(event) => update({ minQuality: event.target.value })}>
          <option value="">Toutes qualités</option>
          {QUALITY_LABELS.slice(1, 6).map((label, index) => (
            <option key={label} value={index + 1}>
              {label} et mieux
            </option>
          ))}
        </select>
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
              {view === "items" ? "Par objet" : "Par personnage"}
            </a>
          ))}
        </nav>
      </div>

      {!available.includes("mail") && data.guilds.length === 0 && (
        <p className="text-xs text-muted">
          Courrier, enchères en cours et banques de guilde s&apos;ajoutent avec l&apos;addon Baganator et l&apos;agent 0.8.0 ou plus récent.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-sm text-muted" role="status">
            {rows.length === 0
              ? "Aucun objet ne correspond."
              : `${plural(rows.length, "objet")} différent${rows.length > 1 ? "s" : ""}, ${plural(total, "exemplaire")}`}
          </p>
          {filtered && (
            <button type="button" className="text-xs text-gold hover:underline" onClick={() => update({ ...DEFAULT_STATE, view: state.view, sort: state.sort })}>
              Effacer les filtres
            </button>
          )}
        </div>
        {state.view === "items" && rows.length > 1 && (
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

      {state.view === "items" ? (
        rows.length > 0 && (
          <>
            <ul className="panel divide-y divide-white/5">
              {rows.slice(0, limit).map((row) => (
                <li key={row.itemKey} className="px-4 py-3" data-quality={row.quality ?? undefined}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 truncate font-semibold">
                      <span className={row.quality === null ? undefined : "quality-text"} title={row.quality === null ? undefined : QUALITY_LABELS[row.quality]}>
                        {row.name ?? `Objet n° ${row.itemKey}`}
                      </span>
                    </h2>
                    <span className="flex-none text-sm tabular-nums">
                      <span className="text-muted">× </span>
                      {formatInteger(row.total)}
                    </span>
                  </div>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {row.holdings.map((holding) => (
                      <li key={holdingKey(holding)}>
                        <HolderChip holding={holding} characters={characters} guilds={guilds} now={now} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {rows.length > limit && (
              <div className="text-center">
                <button type="button" className="button" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                  Afficher {Math.min(PAGE_SIZE, rows.length - limit)} objets de plus ({formatInteger(rows.length - limit)} restants)
                </button>
              </div>
            )}
          </>
        )
      ) : (
        <ByOwner holdings={holdings} data={data} now={now} />
      )}
    </div>
  );
}

const holdingKey = (holding: Holding) =>
  holding.kind === "guild" ? `g${holding.guildId}-${holding.tab}` : `c${holding.characterId}-${holding.location}`;

function tabLabel(guild: InventoryGuild | undefined, tab: number) {
  return guild?.tabs.find((candidate) => candidate.index === tab)?.name ?? `Onglet ${tab}`;
}

/** Un détenteur d'un objet : personnage et endroit, ou guilde et onglet, avec la quantité. */
function HolderChip({
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
      <span className="stat-chip" title={guild ? `${guild.name} (${guild.realm}), ${tabLabel(guild, holding.tab)}` : undefined}>
        <span className="text-text">{guild?.name ?? "Guilde"}</span>
        <span>{tabLabel(guild, holding.tab)}</span>
        <strong>{formatInteger(holding.quantity)}</strong>
      </span>
    );
  }
  const character = characters.get(holding.characterId);
  const note = holdingNote(holding.expiresAt, now);
  return (
    <Link
      href={`/characters/${holding.characterId}`}
      className="stat-chip hover:border-white/25"
      data-class={classKey(character?.class ?? null)}
      title={character ? `${character.name} (${character.realm}), ${PLACE_LABELS[holding.location].toLowerCase()}${note ? `, ${note.text}` : ""}` : undefined}
    >
      <span className="class-text font-semibold">{character?.name ?? "?"}</span>
      <span>{PLACE_LABELS[holding.location]}</span>
      {note?.warn && <span className="text-danger">échu</span>}
      <strong>{formatInteger(holding.quantity)}</strong>
    </Link>
  );
}

/** Présentation par personnage puis par banque de guilde, chaque endroit sous son titre. */
function ByOwner({ holdings, data, now }: { holdings: Holding[]; data: InventoryData; now: Date }) {
  const byCharacter = useMemo(() => groupByCharacter(holdings), [holdings]);
  const byGuild = useMemo(() => groupByGuild(holdings), [holdings]);
  const shownCharacters = data.characters.filter((character) => byCharacter.has(character.id));
  const shownGuilds = data.guilds.filter((guild) => byGuild.has(guild.id));
  if (shownCharacters.length === 0 && shownGuilds.length === 0) return null;

  return (
    <div className="space-y-8">
      {shownCharacters.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {shownCharacters.map((character) => (
            <section key={character.id} className="panel p-4" aria-labelledby={`inventory-character-${character.id}`}>
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1" data-class={classKey(character.class)}>
                <h2 id={`inventory-character-${character.id}`} className="font-semibold">
                  <Link href={`/characters/${character.id}`} className="class-text hover:underline">
                    {character.name}
                  </Link>
                  <span className="ml-2 text-xs font-normal text-muted">
                    {character.level !== null && `Niv. ${character.level} · `}
                    {character.realm} · {character.account.label}
                  </span>
                </h2>
              </header>
              {byCharacter.get(character.id)!.map((group) => (
                <PlaceList
                  key={group.place}
                  title={PLACE_LABELS[group.place]}
                  seen={character.seen[group.place as Exclude<InventoryPlace, "guild">]}
                  group={group}
                  data={data}
                  now={now}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      {shownGuilds.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Banques de guilde</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shownGuilds.map((guild) => (
              <section key={guild.id} className="panel p-4" aria-labelledby={`inventory-guild-${guild.id}`}>
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 id={`inventory-guild-${guild.id}`} className="font-semibold">
                    {guild.name}
                    <span className="ml-2 text-xs font-normal text-muted">
                      {guild.realm} · vue depuis {guild.accountLabel}
                    </span>
                  </h3>
                  <span className="text-sm">
                    <Money copper={guild.moneyCopper} />
                  </span>
                </header>
                {byGuild.get(guild.id)!.map((group) => (
                  <PlaceList key={group.tab} title={tabLabel(guild, group.tab ?? 0)} seen={guild.seenAt} group={group} data={data} now={now} />
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceList({ title, seen, group, data, now }: { title: string; seen: string | null; group: PlaceGroup; data: InventoryData; now: Date }) {
  const total = group.holdings.reduce((sum, holding) => sum + holding.quantity, 0);
  return (
    <div className="mt-4">
      <h4 className="flex items-baseline justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-muted">
        <span>
          {title} <span className="font-normal normal-case tracking-normal text-faint">· {plural(total, "objet")}</span>
        </span>
        {seen && (
          <span className="font-normal normal-case tracking-normal text-faint" title={formatDateTime(seen)}>
            relevé {formatRelative(seen, now)}
          </span>
        )}
      </h4>
      <ul className="mt-1 max-h-72 divide-y divide-white/5 overflow-y-auto pr-1 text-sm">
        {group.holdings.map((holding) => {
          const info = data.items[holding.itemKey];
          const note = holding.kind === "character" ? holdingNote(holding.expiresAt, now) : undefined;
          return (
            <li key={holding.itemKey} className="flex items-baseline justify-between gap-3 py-1" data-quality={info?.quality ?? undefined}>
              <span className="quality-text min-w-0 truncate" title={info?.quality == null ? undefined : QUALITY_LABELS[info.quality]}>
                {info?.name ?? `Objet n° ${holding.itemKey}`}
              </span>
              <span className="flex flex-none items-baseline gap-3">
                {note && <span className={`whitespace-nowrap text-xs ${note.warn ? "text-danger" : "text-faint"}`}>{note.text}</span>}
                <span className="whitespace-nowrap tabular-nums text-muted">× {formatInteger(holding.quantity)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
