import type { Metadata } from "next";
import Link from "next/link";
import { LevelGainsChart, LevelProgressChart } from "@/components/level-charts";
import { EmptyState, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { buildLevelProgress } from "@/lib/dashboard/levels";
import { listLevelSnapshots } from "@/lib/dashboard/queries";
import { classKey, formatDateTime, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Niveaux" };

// La période vient de l'URL : seules ces valeurs sont acceptées, toute autre donne la période par défaut.
const PERIODS = [
  { key: "7", label: "7 jours", days: 7, span: "sur 7 jours" },
  { key: "30", label: "30 jours", days: 30, span: "sur 30 jours" },
  { key: "90", label: "90 jours", days: 90, span: "sur 90 jours" },
  { key: "365", label: "1 an", days: 365, span: "sur un an" },
  { key: "all", label: "Tout", days: null, span: "depuis le premier relevé" },
];
const DEFAULT_PERIOD = PERIODS[1];

export default async function LevelsPage({ searchParams }: PageProps<"/levels">) {
  await requireSession();
  const requested = (await searchParams).period;
  const period = PERIODS.find((entry) => entry.key === requested) ?? DEFAULT_PERIOD;
  const now = new Date();
  const since = period.days === null ? null : new Date(now.getTime() - period.days * 24 * 3600 * 1000);
  const progress = buildLevelProgress(await listLevelSnapshots(getDatabase(), since), since, now);

  const progressed = progress.series.filter((entry) => entry.progressed);
  // Les séries sont triées par gain : la première porte le plus grand.
  const best = progress.series[0]?.gained > 0 ? progress.series[0] : null;
  const latest = progress.series
    .filter((entry) => entry.lastLevelUpAt !== null)
    .toSorted((a, b) => b.lastLevelUpAt!.getTime() - a.lastLevelUpAt!.getTime())[0];

  return (
    <>
      <PageHeader section="characters" title="Niveaux">
        L&apos;évolution des niveaux de tous les personnages, lue dans les relevés envoyés par l&apos;agent. Un niveau gagné porte l&apos;heure du
        relevé qui le montre, pas celle où il s&apos;est produit en jeu.
      </PageHeader>

      <nav aria-label="Période" className="mt-5 flex flex-wrap gap-2">
        {PERIODS.map((entry) => (
          <Link
            key={entry.key}
            href={entry === DEFAULT_PERIOD ? "/levels" : `/levels?period=${entry.key}`}
            prefetch={false}
            className="button"
            aria-current={entry === period ? "true" : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {progress.series.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun relevé">
            Les niveaux se lisent dans les relevés des personnages : ils apparaissent dès la première synchronisation.
          </EmptyState>
        </div>
      ) : (
        <>
          <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label="Niveaux gagnés" value={progress.totalGained} hint={period.span} />
            <StatTile
              label="En progression"
              value={`${progressed.length} / ${progress.series.length}`}
              hint="personnages dont le niveau ou l'expérience a monté"
            />
            <StatTile
              label="Plus forte progression"
              value={best ? best.name : "—"}
              hint={best ? `+${best.gained} niveau${best.gained > 1 ? "x" : ""} · ${best.startLevel} → ${best.endLevel}` : "aucun niveau gagné"}
            />
            <StatTile
              label="Dernier niveau gagné"
              value={latest ? latest.name : "—"}
              hint={latest ? `Niveau ${latest.endLevel} · ${formatRelative(latest.lastLevelUpAt, now)}` : "aucun niveau gagné"}
            />
          </section>

          <div className="mt-6 space-y-4">
            {progressed.length === 0 ? (
              <div className="panel p-5 text-sm text-muted">
                Aucun personnage n&apos;a progressé {period.span}. Une période plus longue montre les progressions plus anciennes.
              </div>
            ) : (
              // La clé remet le graphique à neuf quand la période change : la courbe désignée n'existe peut-être plus.
              <LevelProgressChart key={period.key} progress={progress} />
            )}
            {progress.totalGained > 0 && <LevelGainsChart progress={progress} />}
          </div>

          <section aria-labelledby="by-character" className="mt-8">
            <SectionTitle aside={`${progress.series.length} personnage${progress.series.length > 1 ? "s" : ""} · ${period.span}`}>
              <span id="by-character">Par personnage</span>
            </SectionTitle>
            <div className="panel overflow-x-auto">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th scope="col">Personnage</th>
                    <th scope="col" className="num">
                      Niveau au début
                    </th>
                    <th scope="col" className="num">
                      Niveau à la fin
                    </th>
                    <th scope="col" className="num">
                      Niveaux gagnés
                    </th>
                    <th scope="col">Dernier niveau gagné</th>
                    <th scope="col">Dernier relevé</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.series.map((entry) => {
                    const first = entry.points[0];
                    const last = entry.points[entry.points.length - 1];
                    return (
                      <tr key={entry.id} data-class={classKey(entry.class)}>
                        <td>
                          <Link href={`/characters/${entry.id}`} prefetch={false} className="font-semibold class-text hover:underline">
                            {entry.name}
                          </Link>
                          <span className="block text-xs text-muted">{entry.account}</span>
                        </td>
                        <td className="num">
                          {entry.startLevel}
                          {first.percent !== null && <span className="text-muted"> · {Math.min(first.percent, 99)} %</span>}
                        </td>
                        <td className="num">
                          {entry.endLevel}
                          {last.percent !== null && <span className="text-muted"> · {Math.min(last.percent, 99)} %</span>}
                        </td>
                        <td className="num">{entry.gained > 0 ? `+${entry.gained}` : "—"}</td>
                        <td className="whitespace-nowrap">{formatDateTime(entry.lastLevelUpAt)}</td>
                        <td className="whitespace-nowrap" title={formatDateTime(last.observedAt)}>
                          {formatRelative(last.observedAt, now)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
