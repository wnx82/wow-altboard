import type { Metadata } from "next";
import Link from "next/link";
import { AccountFilter, FilterForm, SelectFilter, TextFilterInput } from "@/components/filter-form";
import { EmptyState, Meter, PageHeader, ProfessionIcon, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { homeHref } from "@/lib/dashboard/browser-state";
import { compareProfessions, PRIMARY_SLOTS, type ProfessionRow } from "@/lib/dashboard/professions";
import { listCharacters, type CharacterListItem } from "@/lib/dashboard/queries";
import { accountOptions, idParam, matchesRoster, readRosterFilter, rosterActive } from "@/lib/dashboard/roster-filter";
import { classKey } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Métiers" };

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export default async function ProfessionsPage({ searchParams }: PageProps<"/professions">) {
  await requireSession();
  const params = await searchParams;
  const roster = readRosterFilter(params);
  const skillLine = idParam(params, "profession");
  // Rangés par niveau décroissant : c'est l'ordre qui départage deux personnages de même rang.
  const characters = await listCharacters(getDatabase());
  const all = compareProfessions(characters, collator.compare);
  const shown = characters.filter((character) => matchesRoster({ name: character.name, accountId: character.account.id }, roster));
  const compared = compareProfessions(shown, collator.compare);
  const chosen = (rows: ProfessionRow<CharacterListItem>[]) => (skillLine === null ? rows : rows.filter((row) => row.skillLine === skillLine));
  const primary = chosen(compared.primary);
  const secondary = chosen(compared.secondary);
  // Un métier choisi : les emplacements libres ne le concernent pas.
  const openSlots = skillLine === null ? compared.openSlots : [];
  const active = rosterActive(roster) || skillLine !== null;
  const known = all.primary.length > 0 || all.secondary.length > 0;

  return (
    <>
      <PageHeader art="camp" section="characters" title="Métiers">
        Qui exerce quoi, et à quel rang : pour chaque métier, les personnages du plus avancé au moins avancé, tous comptes confondus.
      </PageHeader>

      {known && (
        <FilterForm action="/professions" active={active}>
          <SelectFilter
            name="profession"
            label="Métier"
            value={skillLine === null ? "" : String(skillLine)}
            all="Tous les métiers"
            options={[...all.primary, ...all.secondary].map((row) => ({ value: String(row.skillLine), label: row.name }))}
          />
          <AccountFilter accounts={accountOptions(characters.map((character) => ({ accountId: character.account.id, account: character.account.label })))} value={roster.account} />
          <TextFilterInput name="character" label="Personnage" value={roster.character.raw} placeholder="Nom du personnage" />
        </FilterForm>
      )}

      {primary.length === 0 && secondary.length === 0 && openSlots.length === 0 ? (
        <div className="mt-6">
          {known ? (
            <EmptyState title="Aucun métier ne correspond" action={{ href: "/professions", label: "Tout afficher" }}>Élargissez les filtres, ou affichez tout.</EmptyState>
          ) : (
            <EmptyState title="Aucun métier connu">
              Les métiers apparaissent après une synchronisation d&apos;un personnage qui en a appris au moins un.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <ProfessionGrid title="Métiers principaux" rows={primary} />
          <ProfessionGrid title="Métiers secondaires" rows={secondary} />

          {openSlots.length > 0 && (
            <section aria-label="Emplacements libres">
              <SectionTitle aside={`${PRIMARY_SLOTS} métiers principaux par personnage`}>Emplacements libres</SectionTitle>
              <ul className="panel divide-y divide-line">
                {openSlots.map(({ character, open }) => (
                  <li key={character.id} data-class={classKey(character.class)} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      <Link href={`/characters/${character.id}`} prefetch={false} className="font-semibold class-text hover:underline">
                        {character.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{describe(character)}</span>
                    </span>
                    <span className="text-muted">
                      {open} emplacement{open > 1 ? "s" : ""} libre{open > 1 ? "s" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-faint">
                D&apos;après les métiers connus du tableau de bord : un personnage jamais relevé par l&apos;addon paraît sans métier.
              </p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

const describe = (character: CharacterListItem) =>
  [character.level !== null && `Niveau ${character.level}`, character.account.label].filter(Boolean).join(" · ");

function ProfessionGrid({ title, rows }: { title: string; rows: ProfessionRow<CharacterListItem>[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <SectionTitle aside={`${rows.length} métier${rows.length > 1 ? "s" : ""}`}>{title}</SectionTitle>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <li key={row.skillLine} className="panel p-5">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="display text-lg font-bold">
                <ProfessionIcon skillLine={row.skillLine} size={22} /> {row.name}
              </h3>
              <Link href={homeHref({ profession: row.name })} prefetch={false} className="text-xs text-muted hover:text-gold hover:underline">
                {row.holders.length} personnage{row.holders.length > 1 ? "s" : ""}
                <span className="sr-only"> : voir à l&apos;accueil</span>
              </Link>
            </div>
            <ol className="mt-4 space-y-3">
              {row.holders.map(({ character, rank, maxRank }) => (
                <li key={character.id} data-class={classKey(character.class)}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <Link href={`/characters/${character.id}`} prefetch={false} className="truncate font-semibold class-text hover:underline">
                      {character.name}
                    </Link>
                    <span className="whitespace-nowrap tabular-nums text-muted">
                      {rank ?? "—"} / {maxRank ?? "—"}
                    </span>
                  </div>
                  <Meter value={rank} max={maxRank} label={`${row.name} de ${character.name}`} tone="gold" />
                  <p className="mt-1 truncate text-xs text-muted">{describe(character)}</p>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}
