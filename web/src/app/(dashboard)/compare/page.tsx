import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { ScrollRegion } from "@/components/scroll-region";
import { ClassAvatar, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  equipmentRows,
  levelTimeRows,
  listCompareOptions,
  loadComparison,
  MAX_COMPARED,
  professionRows,
  readCompareIds,
  reputationRows,
  statRows,
  bestOf,
  type ComparedCharacter,
  type CompareRow,
  type ReputationCompareRow,
} from "@/lib/dashboard/compare";
import { classKey, classLabel, formatDuration, formatItemLevel, formatMoney, REACTION_LABELS } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Comparer" };

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
const reactionLabel = (reaction: number) => REACTION_LABELS[reaction] ?? `Palier ${reaction}`;

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  await requireSession();
  const db = getDatabase();
  const ids = readCompareIds(await searchParams);
  const [options, characters] = await Promise.all([listCompareOptions(db), loadComparison(db, ids)]);
  // Un choix vide de plus, tant que le maximum n'est pas atteint.
  const slots = Math.min(MAX_COMPARED, Math.max(2, characters.length + 1));

  const picker = (
    <Form action="/compare" prefetch={false} scroll={false} aria-label="Personnages comparés" className="mt-6 flex flex-wrap items-end gap-3">
      {Array.from({ length: slots }, (_, index) => (
        <label key={index} className="block min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="eyebrow">Personnage {index + 1}</span>
          <select className="field mt-1.5 block w-full" name="c" defaultValue={characters[index] ? String(characters[index].id) : ""}>
            <option value="">—</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.level === null ? "niveau ?" : `niveau ${option.level}`}, {option.account})
              </option>
            ))}
          </select>
        </label>
      ))}
      <button className="button" data-variant="primary" type="submit">
        Comparer
      </button>
    </Form>
  );

  const header = (
    <PageHeader art="heroesVista" section="characters" title="Comparer">
      Jusqu&apos;à {MAX_COMPARED} personnages côte à côte : statistiques, équipement, métiers, réputations et temps passé sur chaque niveau. La
      meilleure valeur de chaque ligne est mise en avant.
    </PageHeader>
  );

  if (options.length === 0) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState title="Aucun personnage synchronisé">Les personnages apparaissent après la première synchronisation de l&apos;agent.</EmptyState>
        </div>
      </>
    );
  }

  if (characters.length === 0) {
    return (
      <>
        {header}
        {picker}
        <div className="mt-6">
          <EmptyState title="Choisissez au moins deux personnages">
            Un lien « Comparer » se trouve aussi en haut de la fiche de chaque personnage.
          </EmptyState>
        </div>
      </>
    );
  }

  const identity: CompareRow[] = [
    numberRow("level", "Niveau", characters, (c) => c.level, (value) => String(value)),
    textRow("class", "Classe", characters, (c) => (c.class === null ? null : classLabel(c.class))),
    textRow("race", "Race", characters, (c) => c.race),
    textRow("faction", "Faction", characters, (c) => c.faction),
    textRow("realm", "Royaume", characters, (c) => c.realm),
    textRow("account", "Compte", characters, (c) => c.account),
    textRow("guild", "Guilde", characters, (c) => c.guild),
    numberRow("itemLevel", "Niveau d'objet moyen", characters, (c) => c.itemLevel, formatItemLevel),
    numberRow("money", "Or", characters, (c) => c.moneyCopper, (value) => formatMoney(value)),
    numberRow("played", "Temps de jeu", characters, (c) => c.playedSeconds, (value) => formatDuration(value)),
  ];
  const stats = statRows(characters.map((c) => c.stats));
  const gear = equipmentRows(characters.map((c) => c.equipment));
  const professions = professionRows(
    characters.map((c) => c.professions),
    collator.compare,
  );
  const reputations = reputationRows(
    characters.map((c) => c.reputations),
    reactionLabel,
    collator.compare,
  );
  const levels = levelTimeRows(
    characters.map((c) => c.levelTimes),
    formatDuration,
  );

  return (
    <>
      {header}
      {picker}
      <div className="mt-8 space-y-10">
        <CompareTable title="Identité" characters={characters} rows={identity} />
        <CompareTable title="Statistiques" characters={characters} rows={stats} empty="Aucune statistique relevée : ouvrez la fiche du personnage en jeu." />

        <section aria-label="Équipement">
          <SectionTitle aside="en tête : le plus haut niveau d'objet">Équipement</SectionTitle>
          {gear.length === 0 ? (
            <p className="panel px-5 py-4 text-sm text-muted">Aucun équipement relevé.</p>
          ) : (
            <ScrollRegion className="panel overflow-x-auto" label="Équipement comparé">
              <table className="data-table compare-table">
                <caption className="sr-only">Équipement comparé</caption>
                <CompareHead characters={characters} first="Emplacement" />
                <tbody>
                  {gear.map((row) => (
                    <tr key={row.slot}>
                      <th scope="row" className="text-left font-normal text-muted">
                        {row.label}
                      </th>
                      {row.items.map((item, index) => (
                        <td key={characters[index].id} data-best={row.best.includes(index) ? "" : undefined}>
                          {item === null ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <span data-quality={item.quality ?? undefined}>
                              <span className={item.quality === null ? "" : "quality-text"}>{item.name ?? `Objet ${item.itemId}`}</span>
                              {item.itemLevel !== null && <span className="block text-xs text-muted tabular-nums">Niveau d&apos;objet {item.itemLevel}</span>}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </section>

        <CompareTable title="Métiers" characters={characters} rows={professions} empty="Aucun métier connu." aside="rang / maximum" />
        <ReputationTable characters={characters} rows={reputations} />
        <CompareTable
          title="Temps par niveau"
          characters={characters}
          rows={levels}
          empty="Aucun temps par niveau : il vient de l'addon Allemano Ledger."
          aside="temps de jeu passé sur le niveau ; en tête, le plus rapide"
        />
      </div>
    </>
  );
}

function textRow(key: string, label: string, characters: ComparedCharacter[], value: (character: ComparedCharacter) => string | null): CompareRow {
  return { key, label, values: characters.map(value), best: [] };
}

function numberRow(
  key: string,
  label: string,
  characters: ComparedCharacter[],
  value: (character: ComparedCharacter) => number | null,
  format: (value: number) => string,
): CompareRow {
  const numbers = characters.map(value);
  return { key, label, values: numbers.map((number) => (number === null ? null : format(number))), best: bestOf(numbers) };
}

function CompareHead({ characters, first }: { characters: ComparedCharacter[]; first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col" className="w-48">
          {first}
        </th>
        {characters.map((character) => (
          <th key={character.id} scope="col" data-class={classKey(character.class)}>
            <Link href={`/characters/${character.id}`} prefetch={false} className="inline-flex items-center gap-2 hover:underline">
              <ClassAvatar name={character.name} classToken={character.class} size="sm" />
              <span className="class-text font-semibold">{character.name}</span>
            </Link>
          </th>
        ))}
      </tr>
    </thead>
  );
}

function CompareTable({
  title,
  characters,
  rows,
  empty,
  aside,
}: {
  title: string;
  characters: ComparedCharacter[];
  rows: CompareRow[];
  empty?: string;
  aside?: string;
}) {
  return (
    <section aria-label={title}>
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {rows.length === 0 ? (
        <p className="panel px-5 py-4 text-sm text-muted">{empty}</p>
      ) : (
        <ScrollRegion className="panel overflow-x-auto" label={title}>
          <table className="data-table compare-table">
            <caption className="sr-only">{title}</caption>
            <CompareHead characters={characters} first="" />
            <tbody>
              {rows.map((row) => (
                <CompareLine key={row.key} row={row} characters={characters} />
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </section>
  );
}

function CompareLine({ row, characters }: { row: CompareRow; characters: ComparedCharacter[] }) {
  return (
    <tr>
      <th scope="row" className="text-left font-normal text-muted">
        {row.label}
      </th>
      {row.values.map((value, index) => (
        <td key={characters[index].id} className="tabular-nums" data-best={row.best.includes(index) ? "" : undefined}>
          {value ?? <span className="text-faint">—</span>}
        </td>
      ))}
    </tr>
  );
}

function ReputationTable({ characters, rows }: { characters: ComparedCharacter[]; rows: ReputationCompareRow[] }) {
  return (
    <section aria-label="Réputations">
      <SectionTitle aside="palier · avancement dans le palier">Réputations</SectionTitle>
      {rows.length === 0 ? (
        <p className="panel px-5 py-4 text-sm text-muted">Aucune réputation connue.</p>
      ) : (
        <ScrollRegion className="panel overflow-x-auto" label="Réputations comparées">
          <table className="data-table compare-table">
            <caption className="sr-only">Réputations comparées</caption>
            <CompareHead characters={characters} first="Faction" />
            {[...Map.groupBy(rows, (row) => row.group)].map(([group, list]) => (
              <tbody key={group}>
                <tr>
                  <th scope="rowgroup" colSpan={characters.length + 1} className="eyebrow text-left">
                    {group}
                  </th>
                </tr>
                {list.map((row) => (
                  <CompareLine key={row.key} row={row} characters={characters} />
                ))}
              </tbody>
            ))}
          </table>
        </ScrollRegion>
      )}
    </section>
  );
}
