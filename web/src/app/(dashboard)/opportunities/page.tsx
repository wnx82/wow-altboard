import type { Metadata } from "next";
import Link from "next/link";
import { cache, Suspense } from "react";
import { Confidence, ItemName, MarketSelector, MarketSource, Reasons } from "@/components/economy";
import { AssistantForm, AssistantRetryButton, DailyAuditForm } from "@/components/economy-forms";
import { EmptyState, Money, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { askAssistantAction, writeDailyAuditAction } from "@/lib/economy/actions";
import { assistantConfig, MAX_QUESTION_LENGTH, probeAssistant, type AssistantConfig } from "@/lib/economy/assistant";
import { listDailyAudits, type DailyAudit } from "@/lib/economy/daily-audit";
import { todayInBrussels } from "@/lib/economy/days";
import { loadEconomy } from "@/lib/economy/load";
import { KIND_LABELS, type Opportunity, type OpportunityKind } from "@/lib/economy/opportunities";
import { ensureOpportunityRun } from "@/lib/economy/runs";
import { formatDay, formatPercent, marketParam, marketQuery } from "@/lib/economy/view";
import { formatDateTime, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Opportunités" };

const KINDS = Object.keys(KIND_LABELS) as OpportunityKind[];
const KIND_TONES: Partial<Record<OpportunityKind, "ok" | "warn" | "danger">> = { CRAFT: "ok", PROCESS: "ok", SELL: "ok", BUY: "warn", DONT_CRAFT: "danger" };

// Une seule sonde par affichage, pour l'audit du jour comme pour les questions.
const probe = cache(probeAssistant);

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  await requireSession();
  const params = await searchParams;
  const db = getDatabase();
  const now = new Date();
  const context = await loadEconomy(db, { marketId: marketParam(params.market), now });

  if (!context) {
    return (
      <>
        <Header />
        <div className="mt-6">
          <EmptyState title="Aucun prix reçu">
            Le classement attend un premier scan Auctionator : scannez l&apos;hôtel des ventes, /reload, puis lancez l&apos;agent.
          </EmptyState>
        </div>
      </>
    );
  }

  // Calcul conservé en base, refait seulement quand sa base change (import, synchronisation, réglages).
  const [run, audits] = await Promise.all([ensureOpportunityRun(db, context, now), listDailyAudits(db, context.market.id)]);
  const kind = KINDS.find((entry) => entry === params.kind) ?? null;
  const list = kind ? run.opportunities.filter((o) => o.kind === kind) : run.opportunities;
  const counts = new Map(KINDS.map((entry) => [entry, run.opportunities.filter((o) => o.kind === entry).length]));
  const itemQuery = marketQuery(context.market, context.markets);
  const suffix = marketQuery(context.market, context.markets, "&");
  const gains = run.opportunities.filter((o) => o.kind !== "DONT_CRAFT");
  const assistant = assistantConfig();

  return (
    <>
      <Header />
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Classement de toutes les décisions du moteur : gains attendus pondérés par la confiance, crafts à éviter en fin de liste. Chaque ligne
        garde les valeurs qui l&apos;ont produite. <MarketSource lastImport={context.lastImport} lastDay={formatDay(context.lastImport?.lastDay ?? null)} />
      </p>
      <MarketSelector path="/opportunities" market={context.market} markets={context.markets} />

      <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Opportunités" value={formatInteger(gains.length)} hint={`${counts.get("DONT_CRAFT")} crafts à éviter`} />
        <StatTile label="Gain potentiel" value={<Money copper={gains.reduce((total, o) => total + o.valueCopper, 0)} />} hint="somme brute, avant pondération" />
        <StatTile label="Calcul" value={`n° ${run.id}`} hint={`${run.reused ? "réutilisé" : "calculé"} le ${formatDateTime(run.computedAt)} · moteur v${run.engineVersion}`} />
        <StatTile label="Données jusqu'au" value={formatDay(run.dataThrough)} hint="dernier jour du dernier relevé" />
      </section>

      <nav aria-label="Type" className="mt-6 flex flex-wrap gap-2">
        <Link href={`/opportunities${itemQuery}`} prefetch={false} className="button" aria-current={kind === null ? "true" : undefined}>
          Toutes ({run.opportunities.length})
        </Link>
        {KINDS.filter((entry) => counts.get(entry)! > 0).map((entry) => (
          <Link key={entry} href={`/opportunities?kind=${entry}${suffix}`} prefetch={false} className="button" aria-current={kind === entry ? "true" : undefined}>
            {KIND_LABELS[entry]} ({counts.get(entry)})
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <div className="panel mt-4 p-5 text-sm text-muted">
          Aucune opportunité : aucun signal ne passe les seuils de confiance (50) et d&apos;écart à la médiane avec les relevés actuels.
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {list.map((opportunity, index) => (
            <OpportunityCard key={`${opportunity.kind}-${opportunity.itemKey}-${opportunity.spellId}-${index}`} opportunity={opportunity} rank={run.opportunities.indexOf(opportunity) + 1} names={context.names} query={itemQuery} fallbackDay={run.dataThrough} />
          ))}
        </ol>
      )}

      {(assistant || audits.length > 0) && (
        <DailyAuditSection audits={audits} today={todayInBrussels(now)} currentRun={run.id} config={assistant} marketId={context.market.id} />
      )}

      <section aria-label="Assistant" className="mt-10">
        <SectionTitle aside={assistant ? `modèle ${assistant.model}` : "désactivé"}>Explication en langage naturel</SectionTitle>
        <div className="panel p-5 text-sm text-muted">
          <p>
            L&apos;assistant ne calcule rien : il reçoit les faits structurés du moteur (ceux de ce classement, des crafts, du marché et de vos
            sessions de farm), et toute réponse citant un nombre absent de ces faits est refusée.{" "}
            <a className="text-gold hover:underline" href={`${process.env.WOW_BASE_PATH ?? ""}/api/economy/facts${itemQuery}`}>
              Voir les faits (JSON)
            </a>
          </p>
          <div className="mt-4">
            {assistant ? (
              // Sondé à part : une machine éteinte ne retarde pas le reste de la page.
              <Suspense fallback={<p role="status">Vérification du serveur de l&apos;assistant…</p>}>
                <AssistantPanel config={assistant} marketId={context.market.id} />
              </Suspense>
            ) : (
              <p>
                Désactivé. Pour Claude, définissez <code className="text-text">WOW_AI_PROVIDER=anthropic</code> et{" "}
                <code className="text-text">WOW_AI_API_KEY</code> (clé d&apos;API Anthropic) sur le serveur. Pour une API compatible OpenAI,
                par exemple un Ollama local, définissez <code className="text-text">WOW_AI_URL</code> et{" "}
                <code className="text-text">WOW_AI_MODEL</code>.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** Formulaire de l'assistant, ou la raison de son absence quand son serveur ne répond pas. */
async function AssistantPanel({ config, marketId }: { config: AssistantConfig; marketId: number }) {
  const status = await probe(config);
  if (!status.up) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <AssistantRetryButton />
        <p className="text-danger" role="status">
          {status.error}
        </p>
      </div>
    );
  }
  return <AssistantForm action={askAssistantAction} marketId={marketId} maxLength={MAX_QUESTION_LENGTH} />;
}

/** Audit du jour conservé, ses prédécesseurs, et le bouton qui le rédige quand l'assistant répond. */
function DailyAuditSection({
  audits,
  today,
  currentRun,
  config,
  marketId,
}: {
  audits: DailyAudit[];
  today: string;
  currentRun: number;
  config: AssistantConfig | null;
  marketId: number;
}) {
  const current = audits.find((audit) => audit.day === today) ?? null;
  const previous = audits.filter((audit) => audit !== current);
  return (
    <section aria-label="Audit du jour" className="mt-10">
      <SectionTitle aside={current ? `rédigé le ${formatDateTime(current.writtenAt)} · modèle ${current.model}` : "pas encore rédigé"}>Audit du jour</SectionTitle>
      <div className="panel space-y-4 p-5 text-sm">
        {current ? (
          <>
            <p className="whitespace-pre-line">{current.text}</p>
            <p className="text-xs text-muted">
              Rédigé par l&apos;assistant à partir des faits du calcul n° {current.runId ?? "?"}, données jusqu&apos;au {formatDay(current.dataThrough)}.
              Aucun nombre hors de ces faits n&apos;est admis.
              {current.runId !== currentRun && <span className="text-warn"> Le calcul a changé depuis : réécrivez l&apos;audit pour en tenir compte.</span>}
            </p>
          </>
        ) : (
          <p className="text-muted">
            Un bilan du marché en quelques paragraphes : fraîcheur des relevés, meilleures opportunités, crafts à éviter, mouvements notables et
            limites des données. L&apos;assistant le rédige à partir des seuls faits du moteur, vérifiés comme ses réponses.
          </p>
        )}
        {config && (
          <Suspense fallback={<p className="text-muted" role="status">Vérification du serveur de l&apos;assistant…</p>}>
            <DailyAuditButton config={config} marketId={marketId} rewrite={current !== null} />
          </Suspense>
        )}
        {previous.length > 0 && (
          <details className="text-muted">
            <summary className="cursor-pointer hover:text-text">Audits précédents ({previous.length})</summary>
            <ol className="mt-3 space-y-4">
              {previous.map((audit) => (
                <li key={audit.day}>
                  <p className="eyebrow">
                    {formatDay(audit.day)} · calcul n° {audit.runId ?? "?"} · {audit.model}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-text">{audit.text}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}

async function DailyAuditButton({ config, marketId, rewrite }: { config: AssistantConfig; marketId: number; rewrite: boolean }) {
  const status = await probe(config);
  // La raison et le bouton « Réessayer » sont dans la section de l'assistant, plus bas.
  if (!status.up) return <p className="text-muted">Serveur de l&apos;assistant injoignable : l&apos;audit ne peut pas être rédigé pour l&apos;instant.</p>;
  return <DailyAuditForm action={writeDailyAuditAction} marketId={marketId} rewrite={rewrite} />;
}

function Header() {
  return (
    <>
      <p className="eyebrow text-gold">Économie</p>
      <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Opportunités</h1>
    </>
  );
}

/** Libellés des entrées conservées avec une opportunité ; une clé inconnue s'affiche telle quelle. */
const INPUT_LABELS: Record<string, string> = {
  lastDay: "dernier jour relevé",
  current: "dernier prix (pc)",
  median30: "médiane 30 j (pc)",
  marketValue: "valeur de marché (pc)",
  marketValueBasis: "base de la valeur",
  daysObserved30: "jours relevés sur 30",
  lastAvailable: "en vente au dernier relevé",
  medianAvailable30: "quantité médiane 30 j",
  volatility30: "volatilité 30 j",
  owned: "en stock",
  ratio: "prix / médiane",
  auctionCut: "commission",
  output: "produit",
  outputQuantity: "quantité produite",
  outputUnitValue: "valeur unitaire du produit (pc)",
  outputNet: "produit net (pc)",
  costMarket: "coût des composants (pc)",
  costPrudent: "coût prudent (pc)",
  profit: "profit (pc)",
  roi: "ROI",
  reagentsSellNet: "composants vendus (pc)",
  craftableWithVendor: "fabrications faisables",
  score: "score de farm",
  premium: "écart à la médiane",
  supplyRatio: "offre / habitude",
  perUnit: "valeur à l'unité",
};

const numberFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

function inputValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return numberFormat.format(value);
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function OpportunityCard({
  opportunity,
  rank,
  names,
  query,
  fallbackDay,
}: {
  opportunity: Opportunity;
  rank: number;
  names: Parameters<typeof ItemName>[0]["names"];
  query: string;
  fallbackDay: string | null;
}) {
  const lastDay = (opportunity.inputs.lastDay as string | null | undefined) ?? fallbackDay;
  const perUnit = opportunity.inputs.perUnit === true;
  return (
    <li className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm">
            <span className="mr-2 tabular-nums text-faint">#{rank}</span>
            <span className="badge mr-2" data-tone={KIND_TONES[opportunity.kind]}>
              {KIND_LABELS[opportunity.kind]}
            </span>
            {opportunity.itemKey && <ItemName itemKey={opportunity.itemKey} names={names} query={query} />}
          </p>
          <div className="mt-2">
            <Reasons codes={opportunity.reasonCodes} />
          </div>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-4 text-sm">
          <span className="text-right">
            <span className="block text-lg font-semibold">
              <Money copper={opportunity.valueCopper} />
            </span>
            <span className="text-xs text-muted">{perUnit ? "par unité" : opportunity.kind === "DONT_CRAFT" ? "par fabrication" : "attendu"}</span>
          </span>
          <span className="text-right">
            <Confidence value={opportunity.confidence} />
            <span className="block text-xs text-muted">{opportunity.horizon}</span>
          </span>
        </div>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">Données utilisées · relevé du {formatDay(lastDay)}</summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(opportunity.inputs)
            .filter(([key]) => key !== "reagents" && key !== "confidenceFactors")
            .map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt>{INPUT_LABELS[key] ?? key}</dt>
                <dd className="tabular-nums text-text">{key === "roi" || key === "auctionCut" ? formatPercent(value as number | null) : inputValue(value)}</dd>
              </div>
            ))}
        </dl>
        {Array.isArray(opportunity.inputs.reagents) && (
          <ul className="mt-2 space-y-0.5">
            {(opportunity.inputs.reagents as { item: string; quantity: number; source: string; unit: number | null; owned: number }[]).map((reagent) => (
              <li key={reagent.item}>
                {reagent.quantity} × <ItemName itemKey={reagent.item} names={names} query={query} /> · {reagent.source} ·{" "}
                <Money copper={reagent.unit === null ? null : Math.round(reagent.unit)} /> l&apos;unité · stock {formatInteger(reagent.owned)}
              </li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}
