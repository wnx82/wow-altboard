import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Meter, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { listReputationRows, type ReputationCharacter } from "@/lib/dashboard/queries";
import { compareReputations, type FactionRow, type ReputationHolder } from "@/lib/dashboard/reputations";
import { classKey, formatInteger, REACTION_LABELS } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Réputations" };

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export default async function ReputationsPage() {
  await requireSession();
  const groups = compareReputations(await listReputationRows(getDatabase()), collator.compare);

  return (
    <>
      <PageHeader art="cliffCity" section="characters" title="Réputations">
        Où en est chaque personnage auprès de chaque faction, tous comptes confondus : du plus avancé au moins avancé, d&apos;après le palier
        puis l&apos;avancement dans ce palier.
      </PageHeader>

      {groups.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucune réputation connue">
            Les réputations apparaissent après une synchronisation d&apos;un personnage relevé par l&apos;addon.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {groups.map((group) => (
            <section key={group.name} aria-label={group.name}>
              <SectionTitle aside={`${group.factions.length} faction${group.factions.length > 1 ? "s" : ""}`}>{group.name}</SectionTitle>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.factions.map((faction) => (
                  <FactionPanel key={faction.factionId} faction={faction} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** « Amical · 1 200 / 6 000 » : palier, puis avancement dans le palier. */
function standing(holder: ReputationHolder<ReputationCharacter>): string {
  const reaction = holder.reaction === null ? "Palier inconnu" : (REACTION_LABELS[holder.reaction] ?? `Palier ${holder.reaction}`);
  const { currentValue, minValue, maxValue } = holder;
  if (currentValue === null || minValue === null || maxValue === null || maxValue <= minValue) return reaction;
  return `${reaction} · ${formatInteger(currentValue - minValue)} / ${formatInteger(maxValue - minValue)}`;
}

function FactionPanel({ faction }: { faction: FactionRow<ReputationCharacter> }) {
  return (
    <li className="panel p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="display text-lg font-bold">{faction.name}</h3>
        <span className="text-xs text-muted">
          {faction.holders.length} personnage{faction.holders.length > 1 ? "s" : ""}
        </span>
      </div>
      <ol className="mt-4 space-y-3">
        {faction.holders.map((holder) => {
          const { character } = holder;
          const span = holder.maxValue !== null && holder.minValue !== null ? holder.maxValue - holder.minValue : null;
          const value = holder.currentValue !== null && holder.minValue !== null ? holder.currentValue - holder.minValue : null;
          return (
            <li key={character.id} data-class={classKey(character.class)}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <Link href={`/characters/${character.id}`} prefetch={false} className="truncate font-semibold class-text hover:underline">
                  {character.name}
                </Link>
                <span className="whitespace-nowrap tabular-nums text-muted">{standing(holder)}</span>
              </div>
              <Meter value={value} max={span} label={`${faction.name} pour ${character.name}`} tone="gold" />
              <p className="mt-1 truncate text-xs text-muted">
                {[character.level !== null && `Niveau ${character.level}`, character.account].filter(Boolean).join(" · ")}
              </p>
            </li>
          );
        })}
      </ol>
    </li>
  );
}
