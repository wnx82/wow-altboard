import type { Metadata } from "next";
import Link from "next/link";
import { Change, Confidence, ItemName, MarketSelector, MarketSource } from "@/components/economy";
import { DeleteAlertButton } from "@/components/economy-forms";
import { Sparkline } from "@/components/sparkline";
import { EmptyState, Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { deleteAlertAction } from "@/lib/economy/actions";
import { listAlerts, type AlertStatus } from "@/lib/economy/alerts";
import { itemLabel, loadEconomy } from "@/lib/economy/load";
import { buildMarketView, SORTS, type MarketRow, type MarketSort } from "@/lib/economy/market-view";
import { formatCopperShort, formatDay, marketParam, marketQuery } from "@/lib/economy/view";
import { formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Marché" };

const first = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");

export default async function MarketPage({ searchParams }: PageProps<"/market">) {
  await requireSession();
  const params = await searchParams;
  const context = await loadEconomy(getDatabase(), { marketId: marketParam(params.market), now: new Date() });

  if (!context) {
    return (
      <>
        <Header />
        <div className="mt-6">
          <EmptyState title="Aucun prix reçu">
            Les prix viennent de l&apos;addon Auctionator : faites un scan à l&apos;hôtel des ventes, /reload ou déconnectez-vous, puis lancez
            l&apos;agent.
          </EmptyState>
        </div>
      </>
    );
  }

  const query = first(params.q).slice(0, 80);
  const owned = params.owned === "1";
  const sort: MarketSort = SORTS.find((entry) => entry.key === params.sort)?.key ?? "held";
  const pageNumber = /^\d{1,4}$/.test(first(params.page)) ? Number(first(params.page)) : 1;
  const view = buildMarketView(context, { query, owned, sort, page: pageNumber });
  const alerts = await listAlerts(getDatabase(), { marketId: context.market.id, historyFrom: context.historyFrom });
  const alerted = new Set(alerts.filter((alert) => alert.triggered).map((alert) => alert.itemKey));
  const marketSuffix = marketQuery(context.market, context.markets, "&");
  const itemQuery = marketQuery(context.market, context.markets);
  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current: Record<string, string | null> = { q: query || null, owned: owned ? "1" : null, sort: sort === "held" ? null : sort, page: null, ...changes };
    for (const [key, value] of Object.entries(current)) if (value) next.set(key, value);
    const search = next.toString();
    return `/market${search ? `?${search}` : ""}${search ? marketSuffix : itemQuery}`;
  };

  return (
    <>
      <Header>
        <MarketSource lastImport={context.lastImport} lastDay={formatDay(context.lastImport?.lastDay ?? null)} />{" "}
        {context.historyFrom && <>Prix pris en compte depuis le {formatDay(context.historyFrom)}.</>}
      </Header>
      <MarketSelector path="/market" market={context.market} markets={context.markets} />

      <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Objets suivis" value={formatInteger(view.tracked)} hint={context.market.label} />
        <StatTile label="En stock" value={formatInteger(view.held)} hint="objets possédés par vos personnages" />
        <StatTile label="Dernier relevé" value={formatDay(context.lastImport?.lastDay ?? null)} hint={`${formatInteger(context.market.imports)} fichiers importés`} />
        <StatTile label="Prix anormaux" value={formatInteger(view.anomalyCount)} hint="écart robuste au-delà de 3,5" />
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <MoverList title="Plus fortes hausses (7 j)" rows={view.rising} names={context.names} query={itemQuery} empty="Aucune hausse mesurable." />
        <MoverList title="Plus fortes baisses (7 j)" rows={view.falling} names={context.names} query={itemQuery} empty="Aucune baisse mesurable." />
        <MoverList title="Prix anormaux" rows={view.anomalies} names={context.names} query={itemQuery} empty="Aucun prix isolé." anomaly />
      </div>

      {alerts.length > 0 && <AlertList alerts={alerts} names={context.names} query={itemQuery} />}

      <section aria-label="Tous les objets" className="mt-8">
        <SectionTitle aside={`${formatInteger(view.total)} objet${view.total > 1 ? "s" : ""}`}>Tous les objets</SectionTitle>
        <form method="get" action="/market" className="mb-3 flex flex-wrap items-end gap-3">
          {itemQuery && <input type="hidden" name="market" value={context.market.id} />}
          <label className="block min-w-[14rem] flex-1">
            <span className="eyebrow">Rechercher</span>
            <input className="field mt-1.5 block" type="search" name="q" defaultValue={query} placeholder="Nom ou identifiant d'objet" maxLength={80} />
          </label>
          <label className="block">
            <span className="eyebrow">Trier par</span>
            <select className="field mt-1.5 block" name="sort" defaultValue={sort}>
              {SORTS.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-muted">
            <input type="checkbox" name="owned" value="1" defaultChecked={owned} /> En stock seulement
          </label>
          <button className="button" type="submit">
            Filtrer
          </button>
        </form>

        {view.rows.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">Aucun objet ne correspond.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th scope="col">Objet</th>
                  <th scope="col">30 jours</th>
                  <th scope="col" className="num">
                    Dernier prix
                  </th>
                  <th scope="col" className="num">
                    Valeur de marché
                  </th>
                  <th scope="col" className="num">
                    7 j
                  </th>
                  <th scope="col" className="num">
                    En vente
                  </th>
                  <th scope="col">Liquidité</th>
                  <th scope="col" className="num">
                    Confiance
                  </th>
                  <th scope="col" className="num">
                    En stock
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.itemKey}>
                    <td>
                      <ItemName itemKey={row.itemKey} names={context.names} query={itemQuery} />
                      {row.stats.outlier && (
                        <span className="badge ml-2" data-tone="warn">
                          anormal
                        </span>
                      )}
                      {alerted.has(row.itemKey) && (
                        <span className="badge ml-2" data-tone="warn">
                          alerte
                        </span>
                      )}
                    </td>
                    <td>
                      <Sparkline values={row.spark} label={sparkLabel(row)} />
                    </td>
                    <td className="num">
                      <Money copper={row.stats.current?.minCopper ?? null} />
                    </td>
                    <td className="num">
                      <Money copper={row.stats.marketValue === null ? null : Math.round(row.stats.marketValue)} />
                    </td>
                    <td className="num">
                      <Change value={row.stats.change7d} />
                    </td>
                    <td className="num">{formatInteger(row.stats.lastAvailable)}</td>
                    <td className="text-muted">{row.stats.liquidity}</td>
                    <td className="num">
                      <Confidence value={row.stats.confidence} />
                    </td>
                    <td className="num">{row.owned > 0 ? formatInteger(row.owned) : <span className="text-faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.pages > 1 && (
          <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            {view.page > 1 && (
              <Link className="button" href={link({ page: String(view.page - 1) })} prefetch={false}>
                Précédente
              </Link>
            )}
            <span>
              Page {view.page} sur {view.pages}
            </span>
            {view.page < view.pages && (
              <Link className="button" href={link({ page: String(view.page + 1) })} prefetch={false}>
                Suivante
              </Link>
            )}
          </nav>
        )}
        <p className="mt-3 text-xs text-faint">
          Dernier prix : le plus bas vu au dernier scan. Valeur de marché : médiane des plus bas journaliers sur 14 jours (30 à défaut, trois
          jours au moins). En vente : plus grande quantité vue le dernier jour relevé. Auctionator ne relève ni le nombre d&apos;enchères ni
          l&apos;heure du scan.
        </p>
      </section>
    </>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <PageHeader section="economy" title="Marché">
      {children}
    </PageHeader>
  );
}

const sparkLabel = (row: MarketRow) =>
  row.spark.length < 2
    ? "Moins de deux jours relevés"
    : `${row.spark.length} jours relevés, de ${formatCopperShort(row.spark[0])} à ${formatCopperShort(row.spark[row.spark.length - 1])}`;

function MoverList({
  title,
  rows,
  names,
  query,
  empty,
  anomaly,
}: {
  title: string;
  rows: MarketRow[];
  names: Parameters<typeof ItemName>[0]["names"];
  query: string;
  empty: string;
  anomaly?: boolean;
}) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      {rows.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">{empty}</div>
      ) : (
        <ul className="panel divide-y divide-line">
          {rows.map((row) => (
            <li key={row.itemKey} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                <ItemName itemKey={row.itemKey} names={names} query={query} />
              </span>
              <span className="flex flex-none items-center gap-3 tabular-nums">
                <Sparkline values={row.spark} label={sparkLabel(row)} width={64} height={20} />
                {anomaly ? (
                  <span title="Écart robuste à la médiane des jours précédents">× {row.stats.outlierScore?.toFixed(1)}</span>
                ) : (
                  <Change value={row.stats.change7d} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Alertes posées sur ce marché : déclenchées en tête, chacune retirable sur place. */
function AlertList({ alerts, names, query }: { alerts: AlertStatus[]; names: Parameters<typeof ItemName>[0]["names"]; query: string }) {
  const triggered = alerts.filter((alert) => alert.triggered).length;
  return (
    <section aria-label="Alertes de prix" className="mt-8">
      <SectionTitle aside={`${triggered} déclenchée${triggered > 1 ? "s" : ""} sur ${alerts.length}`}>Alertes de prix</SectionTitle>
      <ul className="panel divide-y divide-line">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-sm">
            <span className="min-w-0">
              <ItemName itemKey={alert.itemKey} names={names} query={query} />
              <span className="ml-2 text-muted">
                {alert.direction === "below" ? "sous" : "au-dessus de"} {formatCopperShort(alert.thresholdCopper)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-3">
              <span className="tabular-nums text-muted">
                {alert.latest ? (
                  <>
                    <Money copper={alert.latest.minCopper} /> le {formatDay(alert.latest.day)}
                  </>
                ) : (
                  "aucun prix relevé"
                )}
              </span>
              <span className="badge" data-tone={alert.triggered ? "warn" : undefined}>
                {alert.triggered ? "déclenchée" : "en attente"}
              </span>
              <DeleteAlertButton action={deleteAlertAction} alertId={alert.id} label={`Retirer l'alerte sur ${itemLabel(names, alert.itemKey)}`} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
