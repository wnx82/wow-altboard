import type { Metadata } from "next";
import Link from "next/link";
import { AccountFilter, FilterForm, SelectFilter, TextFilterInput } from "@/components/filter-form";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { buildActivity, CHANGE_KIND_LABELS, filterActivity, isChangeKind } from "@/lib/dashboard/activity";
import { ACTIVITY_DAYS, listRecentSnapshots } from "@/lib/dashboard/queries";
import { accountOptions, param, readRosterFilter, rosterActive } from "@/lib/dashboard/roster-filter";
import { classKey, formatDateTime, PLAYER_TIME_ZONE } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Activité" };

const dayLabel = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: PLAYER_TIME_ZONE });
const hour = new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: PLAYER_TIME_ZONE });

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await requireSession();
  const params = await searchParams;
  const roster = readRosterFilter(params);
  const requestedKind = param(params, "kind");
  const kind = isChangeKind(requestedKind) ? requestedKind : null;
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVITY_DAYS * 24 * 3600 * 1000);
  const snapshots = await listRecentSnapshots(getDatabase(), since);
  const all = buildActivity(snapshots, since);
  const days = filterActivity(all, roster, kind);
  const active = rosterActive(roster) || kind !== null;

  return (
    <>
      <PageHeader art="mistwood" section="characters" title="Activité">
        Ce qui a changé sur les {ACTIVITY_DAYS} derniers jours, tous personnages confondus : niveaux, or, métiers, réputations, guilde. Un
        changement porte l&apos;heure du relevé qui le montre, pas celle où il s&apos;est produit en jeu.
      </PageHeader>

      {all.length > 0 && (
        <FilterForm action="/activity" active={active}>
          <SelectFilter
            name="kind"
            label="Changement"
            value={kind ?? ""}
            all="Tous les changements"
            options={Object.entries(CHANGE_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <AccountFilter accounts={accountOptions(snapshots.map((snapshot) => snapshot.character))} value={roster.account} />
          <TextFilterInput name="character" label="Personnage" value={roster.character.raw} placeholder="Nom du personnage" />
        </FilterForm>
      )}

      {/* Sans aucun changement, les filtres (alors masqués) n'y sont pour rien. */}
      {days.length === 0 && active && all.length > 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun changement ne correspond" action={{ href: "/activity", label: "Tout afficher" }}>Élargissez les filtres, ou affichez tout.</EmptyState>
        </div>
      ) : days.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun changement sur la période" action={{ href: "/machines", label: "Voir les synchronisations" }}>
            L&apos;activité se lit en comparant deux relevés d&apos;un même personnage : elle apparaît à partir de la deuxième synchronisation
            faite après une session de jeu.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {days.map(({ day, entries }) => (
            <section key={day} aria-label={dayLabel.format(entries[0].at)}>
              <SectionTitle aside={`${entries.length} relevé${entries.length > 1 ? "s" : ""}`}>{dayLabel.format(entries[0].at)}</SectionTitle>
              <ol className="panel divide-y divide-line">
                {entries.map((entry) => (
                  <li
                    key={`${entry.character.id}-${entry.at.toISOString()}`}
                    data-class={classKey(entry.character.class)}
                    className="grid grid-cols-[3.5rem_1fr] gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[3.5rem_14rem_1fr]"
                  >
                    <time className="tabular-nums text-muted" dateTime={entry.at.toISOString()} title={formatDateTime(entry.at)}>
                      {hour.format(entry.at)}
                    </time>
                    <div className="min-w-0">
                      <Link href={`/characters/${entry.character.id}`} prefetch={false} className="block truncate font-semibold class-text hover:underline">
                        {entry.character.name}
                      </Link>
                      <span className="block truncate text-xs text-muted">{entry.character.account}</span>
                    </div>
                    <ul className="col-span-2 flex flex-wrap gap-x-4 gap-y-1 sm:col-span-1">
                      {entry.changes.map((change) => (
                        <li key={change.text} className={change.kind === "level" ? "font-semibold text-gold" : undefined}>
                          {change.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
