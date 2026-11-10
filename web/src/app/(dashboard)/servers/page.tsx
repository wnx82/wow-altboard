import type { Metadata } from "next";
import Link from "next/link";
import { ServerStatusTable, ServiceHistoryPanel, StatusLegend, TransitionsTable } from "@/components/server-status";
import { StatusRefresh } from "@/components/status-refresh";
import { PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { refreshServerStatusAction } from "@/lib/status/actions";
import { syncStatusRuntime } from "@/lib/status/runtime";
import { formatCheckTime, formatEvery, formatLatency } from "@/lib/status/status";
import { getServerStatusView, TRANSITIONS_SHOWN } from "@/lib/status/view";

export const metadata: Metadata = { title: "Serveurs" };

// Références externes, vérifiées le 2026-10-08. Aucune n'alimente les statuts affichés : ils
// viennent des sondes de ce serveur.
const REFERENCES = [
  {
    href: "https://eu.support.blizzard.com/fr/help/article/358479",
    label: "Blizzard — calendrier des maintenances",
    note: "source officielle des maintenances programmées",
  },
  {
    href: "https://theforeverera.com/fr/status/",
    label: "The Forever Era — état des serveurs",
    note: "relève les avis officiels de Blizzard, sans sonder les serveurs",
  },
  {
    href: "https://foreverdb.net/status",
    label: "ForeverDB — server status",
    note: "sondes indépendantes, depuis un autre point du réseau",
  },
];

export default async function ServersPage() {
  await requireSession();
  const { config } = await syncStatusRuntime();
  const view = await getServerStatusView(getDatabase(), config, new Date());
  const intervalSeconds = config.intervalMs / 1000;
  const lastCheck = view.services
    .map((service) => service.checkedAt)
    .filter((checkedAt): checkedAt is string => checkedAt !== null)
    .sort()
    .at(-1);

  return (
    <>
      <PageHeader section="admin" title={<>WoW Forever — État des serveurs {config.label}</>}>
        Ce serveur ouvre une connexion TCP vers chaque adresse configurée, {formatEvery(intervalSeconds)}, mesure le temps de
        réponse et referme. Une connexion acceptée prouve qu&apos;un service écoute, pas que le jeu fonctionne : file d&apos;attente,
        royaume plein ou liste de personnages absente ne se voient pas d&apos;ici.
      </PageHeader>

      {config.errors.length > 0 && (
        <ul role="alert" className="panel mt-6 list-disc space-y-1 p-5 pl-9 text-sm text-warn">
          {config.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <section className="mt-6" aria-label="État actuel">
        <SectionTitle
          aside={
            <StatusRefresh action={refreshServerStatusAction} intervalSeconds={intervalSeconds} enabled={view.configured} />
          }
        >
          État actuel
        </SectionTitle>
        <ServerStatusTable services={view.services} />
        <p className="mt-2 text-xs text-faint">
          {lastCheck ? (
            <>
              Dernier contrôle : <time dateTime={lastCheck}>{formatCheckTime(lastCheck)}</time> (heure de Bruxelles).
            </>
          ) : (
            "Aucun contrôle enregistré."
          )}{" "}
          Dégradé à partir de {formatLatency(config.degradedMs)} ; sans réponse après {formatLatency(config.timeoutMs)}.
        </p>
        <StatusLegend />
        {!view.configured && (
          <div className="panel mt-4 p-5 text-sm text-muted">
            <p className="display text-base font-bold text-gold">Aucun serveur n&apos;est surveillé</p>
            <p className="mt-2 max-w-3xl">
              Sans adresse configurée, rien n&apos;est sondé et l&apos;état reste « Inconnu » plutôt que supposé. Les adresses se
              renseignent dans{" "}
              <Link className="text-text underline decoration-line-strong underline-offset-4 hover:text-gold" href="/settings">
                Paramètres
              </Link>
              , sous la forme <code className="text-text">hôte:port</code>, ou dans l&apos;environnement du serveur. Une adresse de bêta
              n&apos;est pas celle de la production : ne renseigner que des adresses vérifiées.
            </p>
            <code className="mt-3 block break-all rounded-lg bg-ink/70 px-3 py-2 text-text">WOW_STATUS_AUTH_TARGETS=</code>
            <code className="mt-1 block break-all rounded-lg bg-ink/70 px-3 py-2 text-text">WOW_STATUS_GAME_TARGETS=</code>
          </div>
        )}
      </section>

      {view.hasHistory && (
        <>
          <section className="mt-10" aria-label="Disponibilité">
            <SectionTitle aside="durées mesurées par ce serveur">Disponibilité</SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.history.map((history) => (
                <ServiceHistoryPanel key={history.service} history={history} />
              ))}
            </div>
          </section>

          <section className="mt-10" aria-label="Changements d'état">
            <SectionTitle aside={`7 derniers jours, ${TRANSITIONS_SHOWN} au plus`}>Changements d&apos;état</SectionTitle>
            {view.transitions.length === 0 ? (
              <div className="panel p-5 text-sm text-muted">Aucun changement d&apos;état sur la période.</div>
            ) : (
              <TransitionsTable transitions={view.transitions} />
            )}
          </section>
        </>
      )}

      <section className="mt-10" aria-label="Sources">
        <SectionTitle>Sources</SectionTitle>
        <div className="panel p-5 text-sm text-muted">
          <p>
            Les statuts et latences de cette page viennent des sondes TCP de ce serveur, depuis un seul point du réseau : un problème
            entre votre connexion et Blizzard ne s&apos;y voit pas. Les maintenances ne sont pas relevées ici : Blizzard ne publie
            aucune interface documentée pour WoW Forever.
          </p>
          <ul className="mt-3 space-y-1.5">
            {REFERENCES.map((reference) => (
              <li key={reference.href}>
                <a className="text-text underline decoration-line-strong underline-offset-4 hover:text-gold" href={reference.href} target="_blank" rel="noreferrer noopener">
                  {reference.label}
                </a>
                <span className="text-faint"> — {reference.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
