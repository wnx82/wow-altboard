import type { Metadata } from "next";
import { Fragment } from "react";
import { RenameForm, TokenForm } from "@/components/admin-forms";
import { EmptyState, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { agentDirectory, archiveAgent, findAgent, formatAgentSize } from "@/lib/agent-download";
import { requireSession } from "@/lib/auth/session";
import { createTokenAction, renameMachineAction, revokeTokenAction } from "@/lib/dashboard/actions";
import { listMachines, listRecentRuns, machineLabel } from "@/lib/dashboard/queries";
import { isOutdated } from "@/lib/versions";
import { formatDateTime, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Machines" };

const STATUS: Record<string, { label: string; tone: string }> = {
  success: { label: "Réussie", tone: "ok" },
  partial: { label: "Partielle", tone: "warn" },
  failed: { label: "Échouée", tone: "danger" },
};

const ERROR_LABELS: Record<string, string> = {
  agent_warning: "Avertissement de l'agent",
  internal_error: "Erreur du serveur",
};

export default async function MachinesPage() {
  await requireSession();
  const db = getDatabase();
  const [{ machines, pendingTokens }, runs, agent] = await Promise.all([listMachines(db), listRecentRuns(db), findAgent(agentDirectory())]);
  const now = new Date();
  const syncUrl = `${(process.env.WOW_APP_ORIGIN ?? "").replace(/\/$/, "")}${process.env.WOW_BASE_PATH ?? ""}/api/sync`;
  const agentVersion = process.env.WOW_AGENT_VERSION || null;
  const archive = agent ? await archiveAgent(agent, agentVersion) : null;
  const basePath = process.env.WOW_BASE_PATH ?? "";
  const outdated = machines.filter((machine) => isOutdated(machine.agentVersion, agentVersion));

  return (
    <>
      <p className="eyebrow text-gold">Synchronisation</p>
      <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Machines</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Chaque PC exécute l&apos;agent <code className="text-text">AltBoardSync</code>. Tant qu&apos;il tourne, il envoie les données à chaque
        écriture du jeu ; arrêté, rien n&apos;est envoyé.
      </p>

      {agent && archive && (
        <section className="panel mt-6 flex flex-wrap items-center justify-between gap-4 p-5" aria-label="Télécharger l'agent">
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-text">AltBoardSync{agentVersion ? ` ${agentVersion}` : ""}</p>
            <p className="mt-0.5 text-xs text-muted">
              Windows 64 bits · archive ZIP de {formatAgentSize(archive.size)}, instructions comprises ·{" "}
              {/* Liens de téléchargement : les routes d'API ne sont pas des pages, d'où les ancres simples. */}
              <a className="underline hover:text-text" href={`${basePath}/api/agent`} download>
                exécutable seul ({formatAgentSize(agent.size)})
              </a>
            </p>
            <p className="mt-1 break-all text-xs text-faint">SHA-256 de AltBoardSync.exe : {agent.sha256}</p>
            {outdated.length > 0 && (
              <p className="mt-2 text-xs text-warn" role="status">
                À installer sur {outdated.map((machine) => `${machine.label} (${machine.agentVersion})`).join(", ")} : fermez l&apos;agent depuis sa
                fenêtre, remplacez l&apos;exécutable, puis relancez-le.
              </p>
            )}
          </div>
          <a className="button" data-variant="primary" href={`${basePath}/api/agent/zip`} download>
            Télécharger l&apos;agent
          </a>
        </section>
      )}

      <section className="mt-6" aria-label="Machines connues">
        {machines.length === 0 ? (
          <EmptyState title="Aucune machine n'a encore synchronisé">Créez un jeton ci-dessous, puis suivez les instructions.</EmptyState>
        ) : (
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {machines.map((machine) => (
              <li key={machine.id} className="panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="display text-xl font-bold text-gold">{machine.label}</h2>
                  <time className="text-sm text-muted" dateTime={machine.lastSeenAt.toISOString()} title={formatDateTime(machine.lastSeenAt)}>
                    Dernière synchro {formatRelative(machine.lastSeenAt, now)}
                  </time>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="eyebrow">Comptes</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{machine.accounts}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Personnages</dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{machine.characters}</dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Agent</dt>
                    <dd className="mt-0.5">
                      {machine.agentVersion ?? "—"}
                      {isOutdated(machine.agentVersion, agentVersion) && (
                        <span className="badge ml-2" data-tone="warn" title={`Dernière version : ${agentVersion}`}>
                          À mettre à jour
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="eyebrow">Nom d&apos;hôte</dt>
                    <dd className="mt-0.5 truncate" title={machine.hostname ?? undefined}>
                      {machine.hostname ?? "—"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-faint">
                  Identifiant {machine.machineUuid.slice(0, 8)}… · connue depuis le {formatDateTime(machine.firstSeenAt)}
                </p>

                <div className="mt-4 border-t border-line pt-4">
                  <p className="eyebrow mb-2">Jetons</p>
                  <ul className="space-y-2 text-sm">
                    {machine.tokens.map((token) => (
                      <li key={token.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {token.label}
                          <span className="ml-2 text-xs text-muted">
                            {token.lastUsedAt ? `utilisé ${formatRelative(token.lastUsedAt, now)}` : "jamais utilisé"}
                          </span>
                        </span>
                        {token.revokedAt ? (
                          <span className="badge" data-tone="danger">
                            Révoqué
                          </span>
                        ) : (
                          <form action={revokeTokenAction}>
                            <input type="hidden" name="id" value={token.id} />
                            <button className="button" data-variant="danger" type="submit">
                              Révoquer
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <RenameForm
                    id={machine.id}
                    name={machine.displayName}
                    placeholder={machine.hostname ?? "Nom de la machine"}
                    action={renameMachineAction}
                    label={`Nom d'affichage de ${machine.label}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 grid grid-cols-1 gap-6 xl:grid-cols-2" aria-label="Ajouter un PC">
        <div>
          <SectionTitle>Ajouter un PC</SectionTitle>
          <div className="panel p-5">
            <TokenForm action={createTokenAction} />
            {pendingTokens.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="eyebrow mb-2">Jetons en attente de première utilisation</p>
                <ul className="space-y-2 text-sm">
                  {pendingTokens.map((token) => (
                    <li key={token.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {token.label}
                        <span className="ml-2 text-xs text-muted">créé {formatRelative(token.createdAt, now)}</span>
                      </span>
                      {token.revokedAt ? (
                        <span className="badge" data-tone="danger">
                          Révoqué
                        </span>
                      ) : (
                        <form action={revokeTokenAction}>
                          <input type="hidden" name="id" value={token.id} />
                          <button className="button" data-variant="danger" type="submit">
                            Révoquer
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div>
          <SectionTitle>Instructions de synchronisation</SectionTitle>
          <ol className="panel list-decimal space-y-3 p-5 pl-9 text-sm marker:text-gold">
            <li>
              Installez les addons AltBoard et Allemano Ledger dans le jeu :{" "}
              <code className="text-text">World of Warcraft\_forever_\Interface\AddOns</code>. Facultatifs, pour les pages de
              l&apos;économie : Auctionator (prix, après un scan de l&apos;hôtel des ventes) et NaowhForever (recettes, à l&apos;ouverture de chaque
              métier).
            </li>
            <li>
              {agent ? "Téléchargez l'agent, extrayez" : "Copiez"} <code className="text-text">AltBoardSync.exe</code> sur le PC. Aucune
              installation, aucun prérequis.
            </li>
            <li>
              Créez un jeton dans <strong className="font-semibold text-text">Ajouter un PC</strong> et copiez-le : il n&apos;est affiché qu&apos;une
              fois. Un jeton par PC.
            </li>
            <li>
              Double-cliquez sur <code className="text-text">AltBoardSync.exe</code> : sa fenêtre demande le jeton. Collez-le, puis{" "}
              <strong className="font-semibold text-text">Enregistrer</strong>. Il est chiffré pour votre session Windows, et la première
              synchronisation part aussitôt.
            </li>
            <li>
              Dans la fenêtre, activez <strong className="font-semibold text-text">Démarrage avec Windows</strong> pour que l&apos;agent se
              relance à chaque ouverture de session.
            </li>
            <li>
              En jeu, faites <code className="text-text">/reload</code> ou déconnectez-vous : le jeu n&apos;écrit ses données qu&apos;à ce moment-là,
              et l&apos;agent les envoie quelques secondes après.
            </li>
          </ol>
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer hover:text-text">En ligne de commande, ou vers un autre serveur</summary>
            <code className="mt-2 block break-all rounded-lg bg-ink/70 px-3 py-2 text-text">AltBoardSync.exe config set serverUrl {syncUrl}</code>
            <code className="mt-1 block rounded-lg bg-ink/70 px-3 py-2 text-text">AltBoardSync.exe token set</code>
            <code className="mt-1 block rounded-lg bg-ink/70 px-3 py-2 text-text">AltBoardSync.exe sync</code>
          </details>
          <p className="mt-2 text-xs text-faint">
            Un navigateur ne peut pas lire les fichiers du jeu : la synchronisation part toujours du PC, jamais de cette page. Le jeton se
            saisit dans la fenêtre à partir de l&apos;agent 0.4.0.
          </p>
        </div>
      </section>

      <section className="mt-10" aria-label="Dernières synchronisations">
        <SectionTitle aside="15 dernières">Journal des synchronisations</SectionTitle>
        {runs.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">Aucune synchronisation reçue.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Machine</th>
                  <th scope="col">Résultat</th>
                  <th scope="col" className="num">
                    Comptes
                  </th>
                  <th scope="col" className="num">
                    Personnages
                  </th>
                  <th scope="col" className="num">
                    Nouveaux
                  </th>
                  <th scope="col" className="num">
                    Mis à jour
                  </th>
                  <th scope="col" className="num">
                    Inchangés
                  </th>
                  <th scope="col" className="num">
                    Snapshots
                  </th>
                  <th scope="col" className="num">
                    Durée
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const status = STATUS[run.status] ?? { label: run.status, tone: "warn" };
                  const hidden = run.errorsCount - run.errors.length;
                  return (
                    <Fragment key={run.id}>
                      <tr>
                        <td className="whitespace-nowrap" title={formatRelative(run.startedAt, now)}>
                          {formatDateTime(run.startedAt)}
                        </td>
                        <td>{run.machineHostname === null && run.machineDisplayName === null ? "—" : machineLabel({ displayName: run.machineDisplayName, hostname: run.machineHostname })}</td>
                        <td>
                          <span className="badge" data-tone={status.tone}>
                            {status.label}
                          </span>
                        </td>
                        <td className="num">{run.accountsDetected}</td>
                        <td className="num">{run.charactersDetected}</td>
                        <td className="num">{run.charactersCreated}</td>
                        <td className="num">{run.charactersUpdated}</td>
                        <td className="num">{run.charactersUnchanged}</td>
                        <td className="num">{run.snapshotsCreated}</td>
                        <td className="num">{run.durationMs === null ? "—" : `${run.durationMs} ms`}</td>
                      </tr>
                      {run.errors.length > 0 && (
                        <tr>
                          <td colSpan={10} className="text-xs">
                            <ul className="space-y-1">
                              {run.errors.map((error, index) => (
                                <li key={index}>
                                  <span className="font-semibold text-text">{ERROR_LABELS[error.code] ?? error.code}</span>{" "}
                                  <span className="break-words text-muted">{error.message}</span>
                                </li>
                              ))}
                              {hidden > 0 && <li className="text-faint">et {hidden} de plus</li>}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
