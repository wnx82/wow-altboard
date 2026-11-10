import type { Metadata } from "next";
import { AccountReference } from "@/components/account-reference";
import { DeleteAccountForm, RenameForm } from "@/components/admin-forms";
import { EmptyState, Money, StarIcon } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { deleteAccountAction, renameAccountAction, setAccountFeaturedAction } from "@/lib/dashboard/actions";
import { listAccounts } from "@/lib/dashboard/queries";
import { formatDateTime, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Comptes" };

export default async function AccountsPage() {
  await requireSession();
  const accounts = await listAccounts(getDatabase());
  const now = new Date();

  return (
    <>
      <p className="eyebrow text-gold">World of Warcraft</p>
      <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Comptes</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Un compte correspond à un dossier <code className="text-text">WTF\Account</code> : sa référence (identifiant Battle.net et numéro de
        licence WoW) est envoyée par l&apos;agent 0.6.0 et vérifiée contre l&apos;empreinte du compte. Donnez-lui aussi le nom qui vous parle.
      </p>

      {accounts.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun compte synchronisé" />
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <li key={account.id} className="panel p-5" data-featured={account.featured || undefined}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <h2 className="display flex min-w-0 items-center gap-2 text-xl font-bold text-gold">
                  {account.featured && <StarIcon size={18} className="flex-none" />}
                  <span className="min-w-0 break-words">{account.label}</span>
                  {account.featured && <span className="sr-only"> (mis en avant)</span>}
                </h2>
                <AccountReference folderName={account.folderName} folderHint={account.folderHint} />
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="eyebrow">Personnages</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{account.characters}</dd>
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

              <div className="mt-4 space-y-3 border-t border-line pt-4">
                {/* Bouton bascule : son état (aria-pressed) dit si le compte est en avant à l'accueil. */}
                <form action={setAccountFeaturedAction} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input type="hidden" name="id" value={account.id} />
                  <input type="hidden" name="featured" value={account.featured ? "0" : "1"} />
                  <button className="button" type="submit" aria-pressed={account.featured}>
                    <StarIcon filled={account.featured} size={15} />
                    Mettre en avant à l&apos;accueil
                  </button>
                  <span className="text-xs text-muted">
                    {account.featured ? "Ses personnages passent en premier, sous une bannière." : "Ses personnages passeraient en premier à l'accueil."}
                  </span>
                </form>
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
