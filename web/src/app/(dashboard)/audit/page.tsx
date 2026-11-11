import type { Metadata } from "next";
import Link from "next/link";
import { ColumnChart } from "@/components/column-chart";
import { MarketSelector } from "@/components/economy";
import { EmptyState, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { listImports, listRecipeSources, markPartialDays, PARTIAL_SCAN_RATIO } from "@/lib/economy/audit";
import { addDays } from "@/lib/economy/days";
import { loadCoverage, loadEconomy } from "@/lib/economy/load";
import { DEFAULT_PARAMETERS, ENGINE_VERSION } from "@/lib/economy/opportunities";
import { MIN_DAYS_FOR_VALUE, THIN_MARKET_CONFIDENCE_CAP } from "@/lib/economy/prices";
import { listRuns } from "@/lib/economy/runs";
import { DEFAULT_CRAFT_OPTIONS } from "@/lib/economy/craft";
import { formatDay, formatPercent, formatShortDay, marketParam } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Audit" };

const COVERAGE_DAYS = 60;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireSession();
  const params = await searchParams;
  const db = getDatabase();
  const context = await loadEconomy(db, { marketId: marketParam(params.market), now: new Date() });

  if (!context) {
    return (
      <>
        <Header />
        <div className="mt-6">
          <EmptyState title="Aucun prix reçu">L&apos;audit détaille les relevés Auctionator reçus : il attend le premier.</EmptyState>
        </div>
      </>
    );
  }

  const coverageFrom = [context.historyFrom, addDays(context.today, -(COVERAGE_DAYS - 1))].filter((d): d is string => d !== null).sort().at(-1)!;
  const [imports, recipeSources, coverageRows, runs] = await Promise.all([
    listImports(db, context.market.id),
    listRecipeSources(db),
    loadCoverage(db, context.market.id, coverageFrom),
    listRuns(db, context.market.id),
  ]);
  const coverage = markPartialDays(coverageRows);
  const partial = coverage.filter((c) => c.partial).length;
  const stats = [...context.stats.values()];
  const priced = stats.filter((s) => s.marketValue !== null).length;
  const reliable = stats.filter((s) => s.confidence >= DEFAULT_PARAMETERS.minConfidence).length;

  return (
    <>
      <Header>
        D&apos;où viennent les chiffres du moteur, sur quels jours ils reposent, et selon quelles règles une valeur est jugée fiable.
      </Header>
      <MarketSelector path="/audit" market={context.market} markets={context.markets} />

      <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Objets relevés" value={formatInteger(stats.length)} hint={`${formatInteger(priced)} avec une valeur de marché`} />
        <StatTile label="Confiance ≥ 50" value={formatInteger(reliable)} hint="seuil des opportunités" />
        <StatTile label="Début de l'historique" value={formatDay(context.historyFrom)} hint={context.historyFrom ? "relevés antérieurs ignorés" : "tout l'historique compte"} />
        <StatTile label="Jours partiels" value={formatInteger(partial)} hint={`sur ${coverage.length} jours relevés`} />
      </section>

      {coverage.length > 0 && (
        <section aria-label="Couverture" className="mt-8">
          <ColumnChart
            title="Objets relevés par jour"
            note={`colonne atténuée : moins de ${formatPercent(PARTIAL_SCAN_RATIO)} des objets habituels (scan partiel)`}
            series="level"
            scale="count"
            columns={coverage.map((c) => ({
              key: c.day,
              axisLabel: formatShortDay(c.day),
              value: c.items,
              valueLabel: formatInteger(c.items),
              partial: c.partial,
              ariaLabel: `${formatDay(c.day)} : ${formatInteger(c.items)} objets${c.partial ? ", scan partiel" : ""}`,
              tooltip: [`${formatInteger(c.items)} objets${c.partial ? " (partiel)" : ""}`, formatDay(c.day)],
            }))}
          />
        </section>
      )}

      <section aria-label="Relevés Auctionator" className="mt-8">
        <SectionTitle aside="un même fichier n'est importé qu'une fois">Relevés Auctionator reçus</SectionTitle>
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[900px]">
            <thead>
              <tr>
                <th scope="col">Reçu le</th>
                <th scope="col">Compte</th>
                <th scope="col">Machine</th>
                <th scope="col">Fichier écrit le</th>
                <th scope="col">Jours</th>
                <th scope="col" className="num">
                  Objets
                </th>
                <th scope="col" className="num">
                  Relevés
                </th>
                <th scope="col">Empreinte</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.receivedAt)}</td>
                  <td>{row.account}</td>
                  <td className="text-muted">{row.machine ?? "—"}</td>
                  <td>{formatDateTime(row.fileModifiedAt)}</td>
                  <td className="whitespace-nowrap text-muted">
                    {formatDay(row.firstDay)} → {formatDay(row.lastDay)}
                  </td>
                  <td className="num">{formatInteger(row.items)}</td>
                  <td className="num">{formatInteger(row.observations)}</td>
                  <td className="font-mono text-xs text-faint" title={row.contentHash}>
                    {row.contentHash.slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-label="Critères de confiance">
          <SectionTitle aside="score de 0 à 100">Critères de confiance</SectionTitle>
          <div className="panel p-5 text-sm text-muted">
            <p>Moyenne géométrique pondérée de quatre facteurs entre 0 et 1 : un facteur nul annule la confiance.</p>
            <dl className="mt-3 space-y-2">
              <Criterion name="Historique (30 %)">jours relevés sur les 30 derniers, plein à 7 jours.</Criterion>
              <Criterion name="Fraîcheur (30 %)">plein jusqu&apos;à un jour, nul à 10 jours sans relevé.</Criterion>
              <Criterion name="Volume (20 %)">quantité médiane en vente : 0,15 à deux unités ou moins, plein à 20 ; 0,5 si inconnue.</Criterion>
              <Criterion name="Stabilité (20 %)">coefficient de variation robuste (MAD) : plein jusqu&apos;à 15 %, 0,2 au-delà de 100 %.</Criterion>
            </dl>
            <p className="mt-3">
              Marché à une ou deux unités en vente, ou objet relevé moins de {MIN_DAYS_FOR_VALUE} jours : confiance plafonnée à{" "}
              {THIN_MARKET_CONFIDENCE_CAP}. Valeur de marché : médiane des plus bas
              journaliers sur 14 jours, sur 30 à défaut, {MIN_DAYS_FOR_VALUE} jours au moins. Prix anormal : écart robuste de plus de 3,5 à la
              médiane des jours précédents.
            </p>
          </div>
        </section>

        <section aria-label="Réglages du moteur">
          <SectionTitle aside={`moteur v${ENGINE_VERSION}`}>Réglages en vigueur</SectionTitle>
          <div className="panel p-5 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Setting name="Commission HV" value={formatPercent(context.auctionCut)} />
              <Setting name="Début de l'historique" value={formatDay(context.historyFrom)} />
              <Setting name="Craft : ROI minimal" value={formatPercent(DEFAULT_CRAFT_OPTIONS.minRoi)} />
              <Setting name="Craft : confiance minimale" value={String(DEFAULT_CRAFT_OPTIONS.minConfidence)} />
              <Setting name="Opportunités : confiance minimale" value={String(DEFAULT_PARAMETERS.minConfidence)} />
              <Setting name="Vendre : au-dessus de la médiane de" value={formatPercent(DEFAULT_PARAMETERS.sellPremium)} />
              <Setting name="Garder : sous la médiane de" value={formatPercent(DEFAULT_PARAMETERS.keepDiscount)} />
              <Setting name="Acheter : sous la médiane de" value={formatPercent(DEFAULT_PARAMETERS.buyDiscount)} />
              <Setting name="Farmer : score minimal" value={String(DEFAULT_PARAMETERS.minFarmScore)} />
            </dl>
            <p className="mt-3 text-xs text-faint">
              Commission et début de l&apos;historique se règlent dans les{" "}
              <Link href="/settings" prefetch={false} className="text-gold hover:underline">
                paramètres
              </Link>
              .
            </p>
          </div>
        </section>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section aria-label="Recettes">
          <SectionTitle aside="addon NaowhForever">Recettes reçues</SectionTitle>
          {recipeSources.length === 0 ? (
            <div className="panel p-5 text-sm text-muted">Aucune liste de recettes reçue.</div>
          ) : (
            <ul className="panel divide-y divide-line text-sm">
              {recipeSources.map((source) => (
                <li key={source.characterId} data-class={classKey(source.class)} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <Link href={`/characters/${source.characterId}`} prefetch={false} className="font-semibold class-text hover:underline">
                    {source.name}
                  </Link>
                  <span className="text-muted">fichier du {formatDateTime(source.fileModifiedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Calculs">
          <SectionTitle aside="chaque calcul garde ses entrées">Calculs d&apos;opportunités</SectionTitle>
          {runs.length === 0 ? (
            <div className="panel p-5 text-sm text-muted">Aucun calcul : il se fait à la première ouverture de la page Opportunités.</div>
          ) : (
            <ul className="panel divide-y divide-line text-sm">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <span>
                    n° {run.id} · {formatDateTime(run.computedAt)}
                  </span>
                  <span className="text-muted">
                    données au {formatDay(run.dataThrough)} · {run.opportunitiesCount} lignes · v{run.engineVersion}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Limites des données" className="mt-8">
        <SectionTitle>Limites connues</SectionTitle>
        <ul className="panel list-disc space-y-1 p-5 pl-9 text-sm text-muted">
          <li>Auctionator garde un relevé par jour : plus bas et plus haut des prix minimums, plus grande quantité. Aucune heure, aucun nombre d&apos;enchères.</li>
          <li>Un jour peut ne porter que les objets d&apos;un scan partiel (recherche ciblée) : voir la couverture ci-dessus.</li>
          <li>Les noms d&apos;objets viennent des inventaires relevés par AltBoard ; un objet jamais possédé apparaît sous son identifiant.</li>
          <li>Les recettes sont celles que le jeu a montrées à NaowhForever : un métier jamais ouvert en jeu n&apos;a aucune recette ici.</li>
        </ul>
      </section>
    </>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <PageHeader art="ossuary" section="economy" title="Audit">
      {children}
    </PageHeader>
  );
}

function Criterion({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-semibold text-text">{name} : </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}

function Setting({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{name}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
