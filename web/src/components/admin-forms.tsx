"use client";

import { useActionState, useState } from "react";
import type { ActionState, DeleteAccountState, TokenState } from "@/lib/dashboard/actions";

type RenameAction = (previous: ActionState, formData: FormData) => Promise<ActionState>;

/** Nom d'affichage modifiable d'un compte ou d'une machine. Vide = libellé par défaut. */
export function RenameForm({ id, name, placeholder, action, label }: { id: number; name: string | null; placeholder: string; action: RenameAction; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input className="field min-w-40 flex-1" name="name" defaultValue={name ?? ""} placeholder={placeholder} maxLength={60} aria-label={label} />
      <button className="button" type="submit" disabled={pending}>
        {pending ? "…" : "Renommer"}
      </button>
      <span className="basis-full text-xs" role="status">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.saved && <span className="text-ok">Enregistré.</span>}
      </span>
    </form>
  );
}

type DeleteAccountAction = (previous: DeleteAccountState, formData: FormData) => Promise<DeleteAccountState>;

/**
 * Suppression d'un compte en deux temps : le bouton ouvre la confirmation, qui rappelle ce qui
 * disparaît et redemande le mot de passe. Une fois le compte supprimé, la page ne l'affiche plus.
 */
export function DeleteAccountForm({ id, label, reference, characters, action }: { id: number; label: string; reference: string | null; characters: number; action: DeleteAccountAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="button" data-variant="danger" type="button" onClick={() => setOpen(true)}>
        Supprimer ce compte…
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-danger/40 bg-danger/5 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) setOpen(false);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <p className="text-sm font-semibold text-danger">
        Supprimer définitivement « {label} »{reference ? ` (${reference})` : ""} ?
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
        <li>
          Sont supprimés :{" "}
          {characters === 0 ? "le compte, sans personnage" : characters === 1 ? "son personnage et son historique" : `ses ${characters} personnages et leur historique`},
          ses relevés de marché et ses liens aux PC. Les prix déjà relevés restent.
        </li>
        <li>
          Si le dossier existe encore dans <code className="text-text">WTF\Account</code> d&apos;un PC, supprimez-le d&apos;abord : sinon l&apos;agent
          recrée le compte dès que le fichier change.
        </li>
      </ul>
      <label className="block">
        <span className="eyebrow">Mot de passe</span>
        <input className="field mt-1.5 block w-full max-w-xs" type="password" name="password" autoComplete="current-password" required autoFocus />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className="button" data-variant="danger" type="submit" disabled={pending}>
          {pending ? "Suppression…" : "Supprimer définitivement"}
        </button>
        <button className="button" type="button" disabled={pending} onClick={() => setOpen(false)}>
          Annuler
        </button>
        <span className="text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
        </span>
      </div>
    </form>
  );
}

type TokenAction = (previous: TokenState, formData: FormData) => Promise<TokenState>;

/** Création d'un jeton d'agent. Le jeton n'est affiché qu'une fois, juste après sa création. */
export function TokenForm({ action }: { action: TokenAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input className="field min-w-48 flex-1" name="label" placeholder="Nom du PC, par exemple PC-Gaming" maxLength={60} required aria-label="Libellé du jeton" />
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer un jeton"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.token && (
        <div role="status" className="mt-4 rounded-xl border border-gold/40 bg-gold/10 p-4">
          <p className="text-sm font-semibold text-gold">Jeton créé pour « {state.label} »</p>
          <p className="mt-1 text-xs text-muted">Copiez-le maintenant : il ne sera plus jamais affiché. Seule son empreinte est conservée.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-ink/70 px-3 py-2 text-sm">{state.token}</code>
            <button
              type="button"
              className="button"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token!);
                setCopied(true);
              }}
            >
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
