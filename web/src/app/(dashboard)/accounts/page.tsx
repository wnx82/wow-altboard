import type { Metadata } from "next";
import Link from "next/link";
import { AccountReference } from "@/components/account-reference";
import { DeleteAccountForm, RenameForm } from "@/components/admin-forms";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { EmptyState, Money, PageHeader, StarIcon } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { deleteAccountAction, renameAccountAction } from "@/lib/dashboard/actions";
import { homeHref } from "@/lib/dashboard/browser-state";
import { listAccounts } from "@/lib/dashboard/queries";
import { formatDateTime, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Comptes" };

export default async function AccountsPage() {
  await requireSession();
  const accounts = await listAccounts(getDatabase());
  const now = new Date();

  return (
    <>
      <PageHeader art="deepForest" section="admin" title="Comptes">
        Un compte correspond à un dossier <code className="text-text">WTF\Account</code> : sa référence (identifiant Battle.net et numéro de
        licence WoW) est envoyée par l&apos;agent 0.6.0 et vérifiée contre l&apos;empreinte du compte. Donnez-lui aussi le nom qui vous parle.
      </PageHeader>

      {accounts.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun compte synchronisé" action={{ href: "/machines#ajouter-un-pc", label: "Ajouter un PC" }}>
            Un compte apparaît à la première synchronisation d&apos;un PC où il est connecté en jeu.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <li key={account.id} className="panel p-5" data-featured={account.featured || undefined}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <h2 className="display flex min-w-0 items-center gap-2 text-xl font-bold text-gold">
                  {account.featured && <StarIcon size={18} className="flex-none" />}
                  <span className="min-w-0 break-words">{account.label}</span>
                  {account.featured && <span className="sr-only"> (favori)</span>}
                </h2>
                <AccountReference folderName={account.folderName} folderHint={account.folderHint} />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="eyebrow">Personnages</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{account.characters}</dd>
                  {account.characters > 0 && (
                    <dd>
                      <Link href={homeHref({ account: String(account.id) })} prefetch={false} className="text-xs text-gold hover:underline">
                        Voir à l&apos;accueil
                        <span className="sr-only"> les personnages de {account.label}</span>
                      </Link>
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="eyebrow">Niveau max.</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{account.maxLevel ?? "—"}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Or cumulé</dt>
                  <dd className="mt-0.5 text-lg">
                    <Money copper={account.characters > 0 ? account.totalCopper : null} />
                  </dd>
                </div>
              </dl>

              <div className="mt-4 border-t border-line pt-4">
                <p className="eyebrow mb-2">Vu depuis</p>
                <ul className="space-y-1 text-sm">
                  {account.machines.map((machine) => (
                    <li key={machine.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        {machine.label}
                        <span className="ml-2 text-xs text-muted">
                          {[machine.flavor, machine.addonVersion && `AltBoard ${machine.addonVersion}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <time className="text-xs text-muted" dateTime={machine.lastSeenAt.toISOString()} title={formatDateTime(machine.lastSeenAt)}>
                        {formatRelative(machine.lastSeenAt, now)}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>

              {account.addonErrors.length > 0 && (
                <details className="mt-4 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm">
                    <span className="badge" data-tone="warn">
                      {account.addonErrors.length} erreur{account.addonErrors.length > 1 ? "s" : ""} de l&apos;addon
                    </span>
                    <span className="ml-2 text-xs text-muted">dernière {formatRelative(account.addonErrors[0].occurredAt, now)}</span>
                  </summary>
                  <ul className="mt-3 space-y-2 text-xs">
                    {account.addonErrors.map((error, index) => (
                      <li key={index} className="rounded border border-line p-2">
                        <p className="flex flex-wrap justify-between gap-2 text-muted">
                          <span>
                            <code className="text-text">{error.location}</code>
                            {error.addonVersion && <span className="ml-2">AltBoard {error.addonVersion}</span>}
                            <span className="ml-2">{error.machine}</span>
                          </span>
                          <time dateTime={error.occurredAt.toISOString()}>{formatDateTime(error.occurredAt)}</time>
                        </p>
                        <p className="mt-1 break-words font-mono">{error.message}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-faint">
                    Erreurs Lua que l&apos;addon AltBoard a interceptées en jeu (les dix dernières de chaque PC, aussi listées par{" "}
                    <code className="text-text">/ab errors</code>). <code className="text-text">/ab errors clear</code> vide la liste ; elle
                    disparaît d&apos;ici au prochain envoi de l&apos;agent.
                  </p>
                </details>
              )}

              <div className="mt-4 space-y-3 border-t border-line pt-4">
                <FavoriteToggle accountId={account.id} accountLabel={account.label} favorite={account.featured} />
                <RenameForm
                  id={account.id}
                  name={account.displayName}
                  placeholder={`Compte ${account.folderHint ?? ""}`}
                  action={renameAccountAction}
                  label={`Nom d'affichage de ${account.label}`}
                />
                <DeleteAccountForm
                  id={account.id}
                  label={account.label}
                  reference={account.folderName ?? account.folderHint}
                  characters={account.characters}
                  action={deleteAccountAction}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
