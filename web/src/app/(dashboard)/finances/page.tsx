import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart } from "@/components/column-chart";
import { EmptyState, Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  buckets,
  byCharacter,
  distinctDays,
  EXPENSE_LABELS,
  FINANCE_PERIODS,
  financePeriod,
  goldPerHour,
  INCOME_LABELS,
  MIN_SECONDS_FOR_RATE,
  periodStart,
  summarize,
  type ExpenseSource,
  type FinanceBucket,
  type IncomeSource,
} from "@/lib/dashboard/finances";
import { brusselsDay } from "@/lib/dashboard/gold-history";
import { formatDuration } from "@/lib/dashboard/level-times";
import { hasLedgerDays, listLedgerDays } from "@/lib/dashboard/queries";
import { formatCopperShort, formatDay, formatPercent, formatShortDay } from "@/lib/economy/view";
import { classKey, formatMoney } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Finances" };

const monthLabel = new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("fr-BE", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function FinancesPage({ searchParams }: PageProps<"/finances">) {
  await requireSession();
  const params = await searchParams;
  const period = financePeriod(params.period);
  const db = getDatabase();
  const today = brusselsDay(new Date());
  const from = periodStart(period, today);
  const [{ rows: received, characters }, known] = await Promise.all([listLedgerDays(db, from), hasLedgerDays(db)]);
  const rows = distinctDays(received);

  const header = (
    <>
      <PageHeader section="economy" title="Finances">
        D&apos;après l&apos;addon Allemano Ledger : l&apos;or gagné et dépensé chaque jour, par source et par personnage. Les transferts entre vos
        personnages ne sont ni des revenus ni des dépenses. Chaque PC ne compte que les sessions jouées chez lui.
      </PageHeader>
    </>
  );

  if (!known) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState title="Aucune finance connue">
            Les finances viennent de l&apos;addon Allemano Ledger, transmises par l&apos;agent 0.7.0 ou plus récent : elles apparaissent après la
            synchronisation suivante.
          </EmptyState>
        </div>
      </>
    );
  }

  const totals = summarize(rows);
  const rate = goldPerHour(totals);
  const characterTotals = byCharacter(rows);
  const grouping = period.days === null ? "month" : "day";
  const series = buckets(rows, grouping, from, today);
  const bucketLabel = (bucket: FinanceBucket) =>
    grouping === "day" ? formatDay(bucket.key) : monthLabel.format(new Date(`${bucket.key}-01T00:00:00Z`));

  return (
    <>
      {header}
      <nav aria-label="Période" className="mt-5 flex flex-wrap gap-2">
        {FINANCE_PERIODS.map((entry) => (
          <Link
            key={entry.key}
            href={entry.key === "30" ? "/finances" : `/finances?period=${entry.key}`}
            prefetch={false}
            className="button"
            aria-current={entry.key === period.key ? "true" : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="panel mt-6 px-5 py-4 text-sm text-muted">Aucune journée jouée sur la période.</p>
      ) : (
        <div className="mt-6 space-y-10">
          <section aria-label="Vue générale" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Revenus" value={<Money copper={totals.income} />} hint={`${totals.days} jour${totals.days > 1 ? "s" : ""} joué${totals.days > 1 ? "s" : ""}`} />
            <StatTile label="Dépenses" value={<Money copper={totals.expense} />} />
            <StatTile label="Bilan" value={<Money copper={totals.net} />} hint="revenus moins dépenses" />
            <StatTile
              label="Bilan par heure"
              value={rate === null ? "—" : <Money copper={rate} />}
              hint={totals.playedSeconds > 0 ? `sur ${formatDuration(totals.playedSeconds)} de jeu, tous personnages cumulés` : "temps de jeu inconnu"}
            />
            <StatTile label="Butin ramassé" value={<Money copper={totals.lootValue} />} hint="prix de vente au marchand des objets" />
            <StatTile
              label="Transferts entre personnages"
              value={<Money copper={totals.transferIn} />}
              hint={`reçus ; ${formatMoney(totals.transferOut)} envoyés`}
            />
          </section>

          <section aria-label={grouping === "day" ? "Revenus par jour" : "Revenus par mois"}>
            <ColumnChart
              title={grouping === "day" ? "Revenus par jour" : "Revenus par mois"}
              note="date du client de jeu ; le tableau ci-dessous donne aussi les dépenses"
              series="gold"
              scale="money"
              columns={series.map((bucket) => ({
                key: bucket.key,
                axisLabel: grouping === "day" ? formatShortDay(bucket.key) : shortMonth.format(new Date(`${bucket.key}-01T00:00:00Z`)),
                value: bucket.income,
                valueLabel: formatCopperShort(bucket.income),
                partial: false,
                ariaLabel: `${bucketLabel(bucket)} : ${formatMoney(bucket.income)} de revenus, ${formatMoney(bucket.expense)} de dépenses`,
                tooltip: [
                  `${formatCopperShort(bucket.income)} de revenus`,
                  `${formatCopperShort(bucket.expense)} de dépenses`,
                  `bilan ${formatCopperShort(bucket.net)}`,
                  bucketLabel(bucket),
                ],
              }))}
            />
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SourceTable
              title="Revenus par source"
              total={totals.income}
              entries={(Object.keys(INCOME_LABELS) as IncomeSource[]).map((source) => [INCOME_LABELS[source], totals.incomeBySource[source]])}
            />
            <SourceTable
              title="Dépenses par source"
              total={totals.expense}
              entries={(Object.keys(EXPENSE_LABELS) as ExpenseSource[]).map((source) => [EXPENSE_LABELS[source], totals.expenseBySource[source]])}
            />
          </div>

          <section aria-label="Par personnage">
            <SectionTitle aside={`bilan par heure à partir de ${formatDuration(MIN_SECONDS_FOR_RATE)} de jeu`}>Par personnage</SectionTitle>
            <div className="panel overflow-x-auto">
              <table className="data-table min-w-[760px]">
                <thead>
                  <tr>
                    <th scope="col">Personnage</th>
                    <th scope="col" className="num">
                      Revenus
                    </th>
                    <th scope="col" className="num">
                      Dépenses
                    </th>
                    <th scope="col" className="num">
                      Bilan
                    </th>
                    <th scope="col" className="num">
                      Temps
                    </th>
                    <th scope="col" className="num">
                      Bilan par heure
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {characterTotals.map(({ characterId, totals: entry }) => {
                    const character = characters.get(characterId)!;
                    const perHour = goldPerHour(entry);
                    return (
                      <tr key={characterId} data-class={classKey(character.class)}>
                        <th scope="row" className="text-left">
                          <Link href={`/characters/${characterId}`} prefetch={false} className="font-semibold class-text hover:underline">
                            {character.name}
                          </Link>
                          <span className="block text-xs font-normal text-muted">{character.account}</span>
                        </th>
                        <td className="num">
                          <Money copper={entry.income} />
                        </td>
                        <td className="num">
                          <Money copper={entry.expense} />
                        </td>
                        <td className="num">
                          <Money copper={entry.net} />
                        </td>
                        <td className="num tabular-nums">{entry.playedSeconds > 0 ? formatDuration(entry.playedSeconds) : "—"}</td>
                        <td className="num">{perHour === null ? <span className="text-faint">—</span> : <Money copper={perHour} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label={grouping === "day" ? "Par jour" : "Par mois"}>
            <SectionTitle aside="du plus récent au plus ancien">{grouping === "day" ? "Par jour" : "Par mois"}</SectionTitle>
            <div className="panel overflow-x-auto">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">{grouping === "day" ? "Jour" : "Mois"}</th>
                    <th scope="col" className="num">
                      Revenus
                    </th>
                    <th scope="col" className="num">
                      Dépenses
                    </th>
                    <th scope="col" className="num">
                      Bilan
                    </th>
                    <th scope="col" className="num">
                      Temps
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {series
                    .filter((bucket) => bucket.days > 0)
                    .reverse()
                    .map((bucket) => (
                      <tr key={bucket.key}>
                        <th scope="row" className="whitespace-nowrap text-left font-normal">
                          {bucketLabel(bucket)}
                        </th>
                        <td className="num">
                          <Money copper={bucket.income} />
                        </td>
                        <td className="num">
                          <Money copper={bucket.expense} />
                        </td>
                        <td className="num">
                          <Money copper={bucket.net} />
                        </td>
                        <td className="num tabular-nums">{bucket.playedSeconds > 0 ? formatDuration(bucket.playedSeconds) : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function SourceTable({ title, total, entries }: { title: string; total: number; entries: [string, number][] }) {
  const shown = entries.filter(([, amount]) => amount > 0).sort(([, a], [, b]) => b - a);
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      {shown.length === 0 ? (
        <p className="panel px-5 py-4 text-sm text-muted">Rien sur la période.</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col" className="num">
                  Montant
                </th>
                <th scope="col" className="num">
                  Part
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([label, amount]) => (
                <tr key={label}>
                  <th scope="row" className="text-left font-normal">
                    {label}
                  </th>
                  <td className="num">
                    <Money copper={amount} />
                  </td>
                  <td className="num tabular-nums">{formatPercent(amount / total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
