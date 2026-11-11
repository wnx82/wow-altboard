import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { buildActivity } from "@/lib/dashboard/activity";
import { ACTIVITY_DAYS, listRecentSnapshots } from "@/lib/dashboard/queries";
import { classKey, formatDateTime } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Activité" };

const dayLabel = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Brussels" });
const hour = new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

export default async function ActivityPage() {
  await requireSession();
  const now = new Date();
  const since = new Date(now.getTime() - ACTIVITY_DAYS * 24 * 3600 * 1000);
  const days = buildActivity(await listRecentSnapshots(getDatabase(), since), since);

  return (
    <>
      <PageHeader art="mistwood" section="characters" title="Activité">
        Ce qui a changé sur les {ACTIVITY_DAYS} derniers jours, tous personnages confondus : niveaux, or, métiers, réputations, guilde. Un
        changement porte l&apos;heure du relevé qui le montre, pas celle où il s&apos;est produit en jeu.
      </PageHeader>

      {days.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun changement sur la période">
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
