import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ColumnChart } from "@/components/column-chart";
import { Change, Confidence, ItemName, Reasons } from "@/components/economy";
import { PriceAlertForm } from "@/components/economy-forms";
import { PriceChart } from "@/components/price-chart";
import { ScrollRegion } from "@/components/scroll-region";
import { TrendChart } from "@/components/trend-chart";
import { Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { saveAlertsAction } from "@/lib/economy/actions";
import { listAlerts, type AlertStatus } from "@/lib/economy/alerts";
import { DECISION_LABELS } from "@/lib/economy/craft";
import { craftHistory, findPeriod, PERIODS, withinPeriod } from "@/lib/economy/history";
import { itemLabel, itemQuality, loadEconomy, loadItemsHistory } from "@/lib/economy/load";
import { formatMoneyInput, MONEY_INPUT_HINT } from "@/lib/economy/money-input";
import { type ItemScanSeries, loadItemScanSeries, scanSeriesWithin } from "@/lib/economy/scans";
import { holdingPlace } from "@/lib/economy/stock-view";
import { formatChange, formatCopperShort, formatDay, formatPercent, formatShortDay, ITEM_KEY_PATTERN, itemHref, marketParam, marketQuery } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger, QUALITY_LABELS } from "@/lib/wow/format";

// La clé vient de l'URL : seules les formes d'Auctionator sont acceptées (« 1234 », « g:1234:60 »,
// « p:1234 »). Chargement partagé, le temps de la requête, entre les métadonnées et la page.
const decodeKey = (raw: string): string | null => {
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return ITEM_KEY_PATTERN.test(key) ? key : null;
};

const loadContext = cache(async (marketId: number | undefined) => loadEconomy(getDatabase(), { marketId, now: new Date() }));

export async function generateMetadata({ params, searchParams }: PageProps<"/market/[itemKey]">): Promise<Metadata> {
  await requireSession();
  const key = decodeKey((await params).itemKey);
  const context = key ? await loadContext(marketParam((await searchParams).market)) : null;
  return { title: key && context ? itemLabel(context.names, key) : "Objet introuvable" };
}

const PROFIT_SERIES_MIN = 2;

export default async function ItemPage({ params, searchParams }: PageProps<"/market/[itemKey]">) {
  await requireSession();
  const key = decodeKey((await params).itemKey);
  const query = await searchParams;
  const context = key ? await loadContext(marketParam(query.market)) : null;
  if (!key || !context) notFound();

  const stats = context.stats.get(key);
  const producing = context.crafts.filter((craft) => craft.outputKey === key);
  const consuming = context.crafts.filter((craft) => craft.reagents.some((reagent) => reagent.itemKey === key));
  const holdings = context.holdings.get(key) ?? [];
  const vendor = context.vendor.get(key) ?? null;
  // Inventaires cherche par identifiant (« 1234 » et ses variantes) ; une mascotte (« p:… ») n'y a pas d'entrée.
  const inventoryId = /^(?:g:)?(\d{1,10})(?::|$)/.exec(key)?.[1] ?? null;
  const now = new Date();
  const scanSeries =
    inventoryId === null
      ? []
      : await loadItemScanSeries(getDatabase(), {
          itemId: Number(inventoryId),
          flavor: context.market.flavor,
          since: context.historyFrom === null ? null : new Date(`${context.historyFrom}T00:00:00Z`),
          now,
        });
  // Un objet ni relevé à l'hôtel des ventes, ni possédé, ni utilisé par une recette connue : inconnu ici.
  if (!stats && scanSeries.length === 0 && producing.length === 0 && consuming.length === 0 && holdings.length === 0) notFound();

  const period = findPeriod(query.period);
  const recipeKeys = new Set([key, ...producing.flatMap((craft) => craft.reagents.map((reagent) => reagent.itemKey))]);
  const [histories, alerts] = await Promise.all([
    loadItemsHistory(getDatabase(), context.market.id, [...recipeKeys]),
    listAlerts(getDatabase(), { marketId: context.market.id, itemKey: key, historyFrom: context.historyFrom }),
  ]);
  const alertOf = (direction: AlertStatus["direction"]) => alerts.find((alert) => alert.direction === direction);
  const days = withinPeriod(histories.get(key) ?? [], period, context.today, context.historyFrom);
  const name = itemLabel(context.names, key);
  const quality = itemQuality(context.names, key);
  const marketSuffix = marketQuery(context.market, context.markets, "&");
  const itemQuery = marketQuery(context.market, context.markets);
  const owned = context.stock.get(key) ?? 0;
  const scanFrom = period.days === null ? null : new Date(now.getTime() - period.days * 24 * 60 * 60_000);

  return (
    <>
      <PageHeader
        art="harbor"
        section="economy"
        eyebrow={
          <>
            <Link href={`/market${itemQuery}`} prefetch={false}>
              Marché
            </Link>{" "}
            · {context.market.label}
          </>
        }
        title={
          <span data-quality={quality ?? undefined}>
            <span className={quality === null ? undefined : "quality-text"}>{name}</span>
          </span>
        }
      >
        Objet {key}
        {quality !== null && ` · ${QUALITY_LABELS[quality] ?? ""}`}
        {vendor !== null && (
          <>
            {" "}
            · vendu par un marchand <Money copper={Math.round(vendor)} />
          </>
        )}
        {stats?.lastDay && <> · dernier relevé le {formatDay(stats.lastDay)}</>}
      </PageHeader>

      {stats ? (
        <section aria-label="Statistiques" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Dernier prix"
            value={<Money copper={stats.current?.minCopper ?? null} />}
            hint={
              stats.current
                ? stats.current.source === "ezauctioneer" && stats.current.at
                  ? `scan EZAuctioneer du ${formatDateTime(stats.current.at)} (25e percentile)`
                  : `plus bas du scan du ${formatDay(stats.current.day)}`
                : "aucun prix depuis le début de l'historique"
            }
          />
          <StatTile
            label="Valeur de marché"
            value={<Money copper={stats.marketValue === null ? null : Math.round(stats.marketValue)} />}
            hint={stats.marketValueBasis}
          />
          <StatTile
            label="Médianes"
            value={<Money copper={stats.median7 === null ? null : Math.round(stats.median7)} />}
            hint={<>7 j · 30 j : {stats.median30 === null ? "—" : formatCopperShort(stats.median30)}</>}
          />
          <StatTile
            label="Variation 7 j"
            value={<Change value={stats.change7d} />}
            hint={`1 j : ${formatChange(stats.change1d)} · 30 j : ${formatChange(stats.change30d)}`}
          />
          <StatTile
            label="En vente"
            value={formatInteger(stats.lastAvailable)}
            hint={`médiane 30 j : ${formatInteger(stats.medianAvailable30 === null ? null : Math.round(stats.medianAvailable30))} · liquidité ${stats.liquidity}`}
          />
          <StatTile
            label="Confiance"
            value={<Confidence value={stats.confidence} />}
            hint={`${stats.daysObserved30} j relevés sur 30 · volatilité ${formatPercent(stats.volatility30)}${stats.outlier ? " · prix anormal" : ""}`}
          />
        </section>
      ) : (
        <div className="panel mt-6 p-5 text-sm text-muted">Aucun prix relevé pour cet objet sur ce marché depuis le début de l&apos;historique.</div>
      )}

      <section aria-label="Alerte de prix" className="mt-6">
        <SectionTitle aside={<AlertSummary alerts={alerts} />}>Alerte de prix</SectionTitle>
        <div className="panel p-5">
          <PriceAlertForm
            action={saveAlertsAction}
            marketId={context.market.id}
            itemKey={key}
            below={alertOf("below") ? formatMoneyInput(alertOf("below")!.thresholdCopper) : ""}
            above={alertOf("above") ? formatMoneyInput(alertOf("above")!.thresholdCopper) : ""}
            hint={`Comparé au dernier prix relevé (${MONEY_INPUT_HINT}). Champ vide : pas de seuil. Une alerte déclenchée s'affiche sur l'accueil et la page Marché, sans notification.`}
          />
        </div>
      </section>

      <nav aria-label="Période" className="mt-6 flex flex-wrap gap-2">
        {PERIODS.map((entry) => (
          <Link
            key={entry.key}
            href={`${itemHref(key)}${entry.key === "30" ? itemQuery : `?period=${entry.key}${marketSuffix}`}`}
            prefetch={false}
            className="button"
            aria-current={entry.key === period.key ? "true" : undefined}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {days.length === 0 ? (
        <div className="panel mt-4 p-5 text-sm text-muted">Aucun relevé sur cette période.</div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <PriceChart
            title="Prix minimum par jour"
            note="courbe : plus bas du jour · bande : plus bas à plus haut"
            points={days.map((d) => ({
              day: d.day,
              low: d.low,
              high: d.high,
              dateLabel: formatShortDay(d.day),
              lowLabel: formatCopperShort(d.low),
              highLabel: formatCopperShort(d.high),
              availableLabel: d.available === null ? "quantité non relevée" : `${formatInteger(d.available)} en vente`,
            }))}
          />
          <ColumnChart
            title="Quantité en vente"
            note="plus grande quantité vue dans la journée"
            series="level"
            scale="count"
            columns={days.map((d) => ({
              key: d.day,
              axisLabel: formatShortDay(d.day),
              value: d.available,
              valueLabel: formatInteger(d.available),
              partial: false,
              ariaLabel: `${formatDay(d.day)} : ${d.available === null ? "quantité non relevée" : `${formatInteger(d.available)} en vente`}`,
              tooltip: [d.available === null ? "Quantité non relevée" : `${formatInteger(d.available)} en vente`, formatDay(d.day)],
            }))}
          />
        </div>
      )}

      {scanSeries.length > 0 && (
        <section aria-label="Scans EZAuctioneer" className="mt-8">
          <SectionTitle aside="addon EZAuctioneer : chaque scan complet, à son heure">Scans EZAuctioneer</SectionTitle>
          <div className="grid grid-cols-1 gap-6">
            {scanSeries.map((series) => (
              <ScanSeriesPanel key={series.market.id} series={series} within={scanSeriesWithin(series, scanFrom)} periodLabel={period.label} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-label="Stock">
          <SectionTitle
            aside={
              owned > 0 ? (
                <>
                  {formatInteger(owned)} au total
                  {inventoryId !== null && (
                    <>
                      {" · "}
                      <Link href={`/inventory?q=${inventoryId}`} prefetch={false} className="text-gold hover:underline">
                        Voir dans Inventaires
                      </Link>
                    </>
                  )}
                </>
              ) : undefined
            }
          >
            Vos stocks
          </SectionTitle>
          {holdings.length === 0 ? (
            <div className="panel p-5 text-sm text-muted">Aucun personnage n&apos;en possède (sacs et banques relevés).</div>
          ) : (
            <ul className="panel divide-y divide-line">
              {holdings.map((holding) => (
                <li key={holding.characterId} data-class={classKey(holding.characterClass)} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                  <Link href={`/characters/${holding.characterId}`} prefetch={false} className="font-semibold class-text hover:underline">
                    {holding.characterName}
                  </Link>
                  <span className="tabular-nums">
                    {formatInteger(holding.quantity)} <span className="text-xs text-faint">({holdingPlace(holding, formatInteger)})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recettes qui l'utilisent">
          <SectionTitle>Composant de</SectionTitle>
          {consuming.length === 0 ? (
            <div className="panel p-5 text-sm text-muted">Aucune recette connue de vos personnages ne l&apos;utilise.</div>
          ) : (
            <ul className="panel divide-y divide-line">
              {consuming.map((craft) => (
                <li key={craft.spellId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <ItemName itemKey={craft.outputKey} names={context.names} query={itemQuery} />
                  <span className="flex items-center gap-2">
                    <span className="badge">{DECISION_LABELS[craft.decision]}</span>
                    <Money copper={craft.profit === null ? null : Math.round(craft.profit)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {producing.map((craft) => {
        const recipe = context.recipes.find((r) => r.spellId === craft.spellId)!;
        const profit = withinPeriod(
          craftHistory(recipe, (k) => histories.get(k) ?? [], (k) => context.vendor.get(k), context.auctionCut),
          period,
          context.today,
          context.historyFrom,
        );
        return (
          <section key={craft.spellId} aria-label={`Recette ${craft.spellId}`} className="mt-8">
            <SectionTitle aside={`sort ${craft.spellId} · connu de ${recipe.characters.map((c) => c.name).join(", ")}`}>
              Fabrication{craft.outputQuantity > 1 ? ` (× ${craft.outputQuantity})` : ""}
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="panel p-5 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  <div>
                    <dt className="eyebrow">Décision</dt>
                    <dd className="mt-1 font-semibold">{DECISION_LABELS[craft.decision]}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Confiance</dt>
                    <dd className="mt-1">
                      <Confidence value={craft.confidence} />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Produit net</dt>
                    <dd className="mt-1">
                      <Money copper={craft.outputNet === null ? null : Math.round(craft.outputNet)} />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Coût des composants</dt>
                    <dd className="mt-1">
                      <Money copper={craft.costMarket === null ? null : Math.round(craft.costMarket)} />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Profit</dt>
                    <dd className="mt-1">
                      <Money copper={craft.profit === null ? null : Math.round(craft.profit)} />
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">ROI</dt>
                    <dd className="mt-1 tabular-nums">{formatPercent(craft.roi)}</dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <Reasons codes={craft.reasons} />
                </div>
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {craft.reagents.map((reagent) => (
                    <li key={reagent.itemKey} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {reagent.quantity} × <ItemName itemKey={reagent.itemKey} names={context.names} query={itemQuery} />
                        <span className="ml-2 text-xs text-muted">{reagent.source}</span>
                      </span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <Money copper={reagent.unitMarket === null ? null : Math.round(reagent.unitMarket * reagent.quantity)} />
                        <span className="text-xs text-muted">stock {formatInteger(reagent.owned)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {profit.length >= PROFIT_SERIES_MIN ? (
                <TrendChart
                  title="Profit par fabrication, au plus bas du jour"
                  series="gold"
                  points={profit.map((p) => ({
                    at: `${p.day}T12:00:00Z`,
                    value: p.profit / 10_000,
                    label: formatCopperShort(p.profit),
                    dateLabel: formatShortDay(p.day),
                  }))}
                />
              ) : (
                <div className="panel p-5 text-sm text-muted">
                  Pas assez de jours où le produit et chaque composant ont été relevés ensemble pour tracer le profit passé.
                </div>
              )}
            </div>
          </section>
        );
      })}

      {days.length > 0 && (
        <section aria-label="Relevés" className="mt-8">
          <SectionTitle aside={`${days.length} jour${days.length > 1 ? "s" : ""} relevé${days.length > 1 ? "s" : ""}`}>Relevés journaliers</SectionTitle>
          <ScrollRegion className="panel overflow-x-auto" label="Relevés par jour">
            <table className="data-table min-w-[520px]">
              <caption className="sr-only">Relevés par jour</caption>
              <thead>
                <tr>
                  <th scope="col">Jour</th>
                  <th scope="col" className="num">
                    Plus bas
                  </th>
                  <th scope="col" className="num">
                    Plus haut
                  </th>
                  <th scope="col" className="num">
                    En vente
                  </th>
                </tr>
              </thead>
              <tbody>
                {days.toReversed().map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{formatDay(d.day)}</th>
                    <td className="num">
                      <Money copper={d.low} />
                    </td>
                    <td className="num">
                      <Money copper={d.high} />
                    </td>
                    <td className="num">{formatInteger(d.available)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      )}
    </>
  );
}

const SCAN_SERIES_MIN = 2;

/**
 * Un marché d'EZAuctioneer : dernier prix (25e percentile des unités en vente), variation sur 24 h,
 * unités en vente, et courbe scan par scan ; les jours plus anciens que la fenêtre gardée y
 * figurent par leur médiane.
 */
function ScanSeriesPanel({ series, within, periodLabel }: { series: ItemScanSeries; within: ReturnType<typeof scanSeriesWithin>; periodLabel: string }) {
  const { latest } = series;
  const points = [
    ...within.days.map((day) => ({
      at: `${day.day}T12:00:00Z`,
      value: day.median / 10_000,
      label: `${formatCopperShort(day.median)} (médiane de ${day.scans} scan${day.scans > 1 ? "s" : ""})`,
      dateLabel: formatShortDay(day.day),
    })),
    ...within.points.map((point) => ({
      at: point.at.toISOString(),
      value: point.price / 10_000,
      label: `${formatCopperShort(point.price)} · ${formatInteger(point.units)} en vente`,
      dateLabel: formatDateTime(point.at),
    })),
  ];
  return (
    <div className="panel p-5">
      <h3 className="font-semibold">{series.market.label}</h3>
      {series.variants > 0 && (
        <p className="mt-1 text-xs text-muted">
          {series.variants} variante{series.variants > 1 ? "s" : ""} à suffixe aléatoire relevée{series.variants > 1 ? "s" : ""} à part, non comprise
          {series.variants > 1 ? "s" : ""} ici.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Dernier prix"
          value={<Money copper={latest?.price ?? null} />}
          hint={
            latest
              ? `25e percentile, scan du ${formatDateTime(latest.at)}`
              : series.days.length === 0 && series.variants > 0
                ? "relevé seulement sous ses variantes à suffixe"
                : "aucun scan dans les 60 derniers jours"
          }
        />
        <StatTile label="Variation 24 h" value={<Change value={series.change24h} />} hint="face au scan d'au moins 24 h plus tôt" />
        <StatTile label="En vente" value={formatInteger(latest?.units ?? null)} hint="unités au dernier scan" />
        <StatTile
          label="Scans"
          value={formatInteger(within.points.length)}
          hint={`${periodLabel}${within.days.length > 0 ? ` · plus ${within.days.length} jour${within.days.length > 1 ? "s" : ""} résumé${within.days.length > 1 ? "s" : ""}` : ""}`}
        />
      </div>
      <div className="mt-4">
        {points.length >= SCAN_SERIES_MIN ? (
          <TrendChart title="Prix à chaque scan (25e percentile des unités en vente)" series="gold" points={points} />
        ) : (
          <p className="text-sm text-muted">Moins de deux scans sur cette période : pas de courbe.</p>
        )}
      </div>
    </div>
  );
}

/** État des alertes de l'objet, à côté du titre de la section. */
function AlertSummary({ alerts }: { alerts: AlertStatus[] }) {
  if (alerts.length === 0) return "aucune alerte";
  const triggered = alerts.filter((alert) => alert.triggered);
  if (triggered.length === 0) return alerts[0].latest ? "en attente" : "en attente · aucun prix relevé";
  return (
    <span className="badge" data-tone="warn">
      déclenchée : {triggered[0].direction === "below" ? "sous" : "au-dessus de"} {formatCopperShort(triggered[0].thresholdCopper)}
    </span>
  );
}
