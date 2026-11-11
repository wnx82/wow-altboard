import type { Metadata } from "next";
import Link from "next/link";
import { FlowChart } from "@/components/flow-chart";
import { ClassAvatar, EmptyState, Meter, Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import {
  buckets,
  byCharacter,
  change,
  distinctDays,
  EXPENSE_LABELS,
  FINANCE_PERIODS,
  financePeriod,
  goldPerHour,
  highlights,
  INCOME_LABELS,
  MIN_SECONDS_FOR_RATE,
  periodStart,
  previousPeriodStart,
  summarize,
  type Change,
  type ExpenseSource,
  type FinanceBucket,
  type IncomeSource,
} from "@/lib/dashboard/finances";
import { brusselsDay } from "@/lib/dashboard/gold-history";
import { formatDuration } from "@/lib/dashboard/level-times";
import { hasLedgerDays, listLedgerDays } from "@/lib/dashboard/queries";
import { formatChange, formatCopperShort, formatDay, formatPercent, formatShortDay } from "@/lib/economy/view";
import { classKey, formatMoney } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Finances" };

const monthLabel = new Intl.DateTimeFormat("fr-BE", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonth = new Intl.DateTimeFormat("fr-BE", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Montant lisible avec son signe : formatMoney ne connaît que les montants positifs. */
const signedMoney = (copper: number) => `${copper < 0 ? "−" : ""}${formatMoney(Math.abs(copper))}`;
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

export default async function FinancesPage({ searchParams }: PageProps<"/finances">) {
  await requireSession();
  const params = await searchParams;
  const period = financePeriod(params.period);
  const db = getDatabase();
  const today = brusselsDay(new Date());
  const from = periodStart(period, today);
  // La période précédente, de même longueur, est lue en même temps : elle sert à la comparaison.
  const [{ rows: received, characters }, known] = await Promise.all([listLedgerDays(db, previousPeriodStart(period, today)), hasLedgerDays(db)]);
  const all = distinctDays(received);
  const rows = from === null ? all : all.filter((row) => row.day >= from);
  const previousRows = from === null ? [] : all.filter((row) => row.day < from);

  const intro = (
    <>
      D&apos;après l&apos;addon Allemano Ledger : l&apos;or gagné et dépensé chaque jour, par source et par personnage. Les transferts entre vos personnages
      ne sont ni des revenus ni des dépenses. Chaque PC ne compte que les sessions jouées chez lui.
    </>
  );

  if (!known) {
    return (
      <>
        <PageHeader art="galleons" section="economy" title="Finances">
          {intro}
        </PageHeader>
        <div className="mt-6">
          <EmptyState title="Aucune finance connue">
            Les finances viennent de l&apos;addon Allemano Ledger, transmises par l&apos;agent 0.7.0 ou plus récent : elles apparaissent après la
            synchronisation suivante.
          </EmptyState>
        </div>
      </>
    );
  }

  const periodNav = (
    <nav aria-label="Période" className="segmented">
      {FINANCE_PERIODS.map((entry) => (
        <Link
          key={entry.key}
          href={entry.key === "30" ? "/finances" : `/finances?period=${entry.key}`}
          prefetch={false}
          aria-current={entry.key === period.key ? "true" : undefined}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
  const header = (
    <PageHeader art="galleons" section="economy" title="Finances" actions={periodNav}>
      {intro}
    </PageHeader>
  );

  if (rows.length === 0) {
    return (
      <>
        {header}
        <div className="mt-6">
          <EmptyState title="Aucune journée jouée sur la période">Choisissez une période plus longue pour retrouver vos dernières sessions.</EmptyState>
        </div>
      </>
    );
  }

  const totals = summarize(rows);
  const previous = previousRows.length > 0 ? summarize(previousRows) : null;
  const against = period.days === null ? "" : `par rapport aux ${period.days} jours précédents`;
  const rate = goldPerHour(totals);
  const characterTotals = byCharacter(rows);
  const grouping = period.days === null ? "month" : "day";
  const series = buckets(rows, grouping, from, today);
  const { best, costliest } = highlights(series);
  const topCharacter = characterTotals[0];
  const bucketLabel = (bucket: FinanceBucket) =>
    grouping === "day" ? formatDay(bucket.key) : monthLabel.format(new Date(`${bucket.key}-01T00:00:00Z`));
  const unitLabel = grouping === "day" ? "jour" : "mois";

  return (
    <>
      {header}
      <div className="mt-6 space-y-10">
        <section aria-label="Vue générale" className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="panel finance-hero p-5 sm:p-6 lg:col-span-3" data-tone={totals.net < 0 ? "danger" : "ok"}>
            <p className="eyebrow">Bilan {period.days === null ? "depuis le début" : `des ${period.days} derniers jours`}</p>
            <div className="hero-figure mt-3">
              <Money copper={totals.net} />
            </div>
            <div className="mt-2">
              {previous ? (
                <Delta change={change(totals.net, previous.net)} upIsGood against={against} />
              ) : (
                period.days !== null && <p className="text-xs text-muted">Aucune journée jouée sur les {period.days} jours précédents : rien à comparer.</p>
              )}
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
              <div>
                <dt className="legend-key text-xs text-muted">
                  <span className="legend-swatch" data-key="income" aria-hidden="true" />
                  Revenus
                </dt>
                <dd className="mt-1 text-lg font-semibold">
                  <Money copper={totals.income} />
                </dd>
                {previous && (
                  <dd className="mt-0.5">
                    <Delta change={change(totals.income, previous.income)} upIsGood />
                  </dd>
                )}
              </div>
              <div>
                <dt className="legend-key text-xs text-muted">
                  <span className="legend-swatch" data-key="expense" aria-hidden="true" />
                  Dépenses
                </dt>
                <dd className="mt-1 text-lg font-semibold">
                  <Money copper={totals.expense} />
                </dd>
                {previous && (
                  <dd className="mt-0.5">
                    <Delta change={change(totals.expense, previous.expense)} upIsGood={false} />
                  </dd>
                )}
              </div>
            </dl>

            {totals.income > 0 && (
              <div className="mt-5">
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs text-muted">
                  <span>Dépenses rapportées aux revenus</span>
                  <span className="font-semibold tabular-nums text-text">{formatPercent(totals.expense / totals.income)}</span>
                </div>
                <Meter value={Math.min(totals.expense, totals.income)} max={totals.income} label="Dépenses rapportées aux revenus" tone="expense" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 lg:col-span-2">
            <StatTile
              label="Bilan par heure"
              value={rate === null ? "—" : <Money copper={rate} />}
              hint={totals.playedSeconds > 0 ? `sur ${formatDuration(totals.playedSeconds)} de jeu` : "temps de jeu inconnu"}
            />
            <StatTile label="Par jour joué" value={<Money copper={Math.round(totals.net / totals.days)} />} hint={`bilan moyen sur ${plural(totals.days, "jour")}`} />
            <StatTile label="Butin ramassé" value={<Money copper={totals.lootValue} />} hint="au prix de vente du marchand" />
            <StatTile label="Transferts reçus" value={<Money copper={totals.transferIn} />} hint={`entre vos personnages ; ${formatCopperShort(totals.transferOut)} envoyés`} />
          </div>
        </section>

        <section aria-label={grouping === "day" ? "Revenus et dépenses par jour" : "Revenus et dépenses par mois"}>
          <FlowChart
            title={grouping === "day" ? "Revenus et dépenses par jour" : "Revenus et dépenses par mois"}
            note="date du client de jeu ; le détail est dans le tableau plus bas"
            columns={series.map((bucket) => ({
              key: bucket.key,
              axisLabel: grouping === "day" ? formatShortDay(bucket.key) : shortMonth.format(new Date(`${bucket.key}-01T00:00:00Z`)),
              income: bucket.income,
              expense: bucket.expense,
              net: bucket.days > 0 ? bucket.net : null,
              ariaLabel:
                bucket.days > 0
                  ? `${bucketLabel(bucket)} : ${formatMoney(bucket.income)} de revenus, ${formatMoney(bucket.expense)} de dépenses, bilan ${signedMoney(bucket.net)}`
                  : `${bucketLabel(bucket)} : pas joué`,
              tooltip:
                bucket.days > 0
                  ? [
                      bucketLabel(bucket),
                      `Revenus ${formatCopperShort(bucket.income)}`,
                      `Dépenses ${formatCopperShort(bucket.expense)}`,
                      `Bilan ${formatCopperShort(bucket.net)}`,
                    ]
                  : [bucketLabel(bucket), "pas joué"],
            }))}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {best && (
              <StatTile
                label={`Meilleur ${unitLabel}`}
                value={<Money copper={best.net} />}
                hint={`${bucketLabel(best)} · ${formatCopperShort(best.income)} gagnés`}
                tone={best.net > 0 ? "ok" : undefined}
              />
            )}
            {costliest && (
              <StatTile label={grouping === "day" ? "Jour le plus coûteux" : "Mois le plus coûteux"} value={<Money copper={costliest.expense} />} hint={`${bucketLabel(costliest)} · bilan ${formatCopperShort(costliest.net)}`} />
            )}
            {topCharacter && characters.get(topCharacter.characterId) && (
              <StatTile
                label="Personnage le plus rentable"
                value={
                  <span data-class={classKey(characters.get(topCharacter.characterId)!.class)}>
                    <Link href={`/characters/${topCharacter.characterId}`} prefetch={false} className="class-text hover:underline">
                      {characters.get(topCharacter.characterId)!.name}
                    </Link>
                  </span>
                }
                hint={`bilan ${formatCopperShort(topCharacter.totals.net)} · ${formatPercent(totals.income > 0 ? topCharacter.totals.income / totals.income : null)} des revenus`}
              />
            )}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <SourceBars
            title="Revenus par source"
            tone="income"
            total={totals.income}
            entries={(Object.keys(INCOME_LABELS) as IncomeSource[]).map((source) => [INCOME_LABELS[source], totals.incomeBySource[source]])}
          />
          <SourceBars
            title="Dépenses par source"
            tone="expense"
            total={totals.expense}
            entries={(Object.keys(EXPENSE_LABELS) as ExpenseSource[]).map((source) => [EXPENSE_LABELS[source], totals.expenseBySource[source]])}
          />
        </div>

        <section aria-label="Par personnage">
          <SectionTitle aside={`bilan par heure à partir de ${formatDuration(MIN_SECONDS_FOR_RATE)} de jeu`}>Par personnage</SectionTitle>
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[880px]">
              <thead>
                <tr>
                  <th scope="col">Personnage</th>
                  <th scope="col" className="num">
                    Revenus
                  </th>
                  <th scope="col">Part des revenus</th>
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
                  const share = totals.income > 0 ? entry.income / totals.income : null;
                  return (
                    <tr key={characterId} data-class={classKey(character.class)}>
                      <th scope="row" className="text-left">
                        <span className="flex items-center gap-3">
                          <ClassAvatar name={character.name} classToken={character.class} size="sm" />
                          <span className="min-w-0">
                            <Link href={`/characters/${characterId}`} prefetch={false} className="font-semibold class-text hover:underline">
                              {character.name}
                            </Link>
                            <span className="block truncate text-xs font-normal text-muted">{character.account}</span>
                          </span>
                        </span>
                      </th>
                      <td className="num">
                        <Money copper={entry.income} />
                      </td>
                      <td className="w-40">
                        <span className="flex items-center gap-2">
                          <span className="flex-1">
                            <Meter value={entry.income} max={totals.income} label={`Part des revenus de ${character.name}`} tone="income" />
                          </span>
                          <span className="w-10 text-right text-xs tabular-nums text-muted">{formatPercent(share)}</span>
                        </span>
                      </td>
                      <td className="num">
                        <Money copper={entry.expense} />
                      </td>
                      <td className="num font-semibold">
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

        <section aria-label={grouping === "day" ? "Détail par jour" : "Détail par mois"}>
          <SectionTitle aside="du plus récent au plus ancien">{grouping === "day" ? "Détail par jour" : "Détail par mois"}</SectionTitle>
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
                        {bucket.key === best?.key && (
                          <span className="badge ml-2" data-tone="gold">
                            meilleur {unitLabel}
                          </span>
                        )}
                      </th>
                      <td className="num">
                        <Money copper={bucket.income} />
                      </td>
                      <td className="num">
                        <Money copper={bucket.expense} />
                      </td>
                      <td className="num font-semibold">
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
    </>
  );
}

/**
 * Écart avec la période précédente : flèche, montant signé et pourcentage. La couleur dit si c'est
 * une bonne nouvelle (plus de revenus, moins de dépenses) ; la flèche et le signe le disent aussi.
 */
function Delta({ change: value, upIsGood, against }: { change: Change; upIsGood: boolean; against?: string }) {
  const direction = Math.sign(value.diff);
  const tone = direction === 0 ? undefined : direction > 0 === upIsGood ? "ok" : "danger";
  return (
    <p className="delta" data-tone={tone}>
      <span className="delta-value">
        <span aria-hidden="true">{direction > 0 ? "▲ " : direction < 0 ? "▼ " : "= "}</span>
        <span className="whitespace-nowrap">{direction === 0 ? "stable" : `${direction > 0 ? "+" : ""}${formatCopperShort(value.diff)}`}</span>
        {direction !== 0 && value.ratio !== null && <span className="whitespace-nowrap"> ({formatChange(value.ratio)})</span>}
      </span>
      {against && <span>{against}</span>}
    </p>
  );
}

/** Sources classées de la plus grosse à la plus petite : montant, part et barre de la part. */
function SourceBars({ title, tone, total, entries }: { title: string; tone: "income" | "expense"; total: number; entries: [string, number][] }) {
  const shown = entries.filter(([, amount]) => amount > 0).sort(([, a], [, b]) => b - a);
  return (
    <section aria-label={title}>
      <SectionTitle aside={total > 0 ? <Money copper={total} /> : undefined}>{title}</SectionTitle>
      {shown.length === 0 ? (
        <p className="panel px-5 py-4 text-sm text-muted">Rien sur la période.</p>
      ) : (
        <ul className="panel space-y-4 px-5 py-5">
          {shown.map(([label, amount]) => (
            <li key={label}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="legend-key font-medium">
                  <span className="legend-swatch" data-key={tone} aria-hidden="true" />
                  {label}
                </span>
                <span className="flex items-baseline gap-3">
                  <Money copper={amount} />
                  <span className="w-10 text-right text-xs tabular-nums text-muted">{formatPercent(amount / total)}</span>
                </span>
              </div>
              <Meter value={amount} max={total} label={`${label} : part du total`} tone={tone} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
