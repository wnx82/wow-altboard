"use client";

import { useActionState } from "react";
import type { NotifySettingsState, NotifyTestState } from "@/lib/notify/actions";

type SaveAction = (previous: NotifySettingsState, formData: FormData) => Promise<NotifySettingsState>;
type TestAction = () => Promise<NotifyTestState>;

/**
 * Webhook des notifications : adresse et jeton jamais réaffichés (un champ vide garde la valeur en
 * place), événements envoyés, délai d'un PC muet.
 */
export function NotifySettingsForm({
  action,
  maskedUrl,
  hasToken,
  events,
  silentDays,
  maxSilentDays,
}: {
  action: SaveAction;
  /** « https://hôte/… » ; null sans webhook. */
  maskedUrl: string | null;
  hasToken: boolean;
  events: { key: string; label: string; enabled: boolean }[];
  silentDays: number;
  maxSilentDays: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="eyebrow">Adresse du webhook</span>
        <input
          className="field mt-1.5 block font-mono"
          name="url"
          type="url"
          inputMode="url"
          placeholder={maskedUrl ? `${maskedUrl} (enregistrée)` : "https://n8n.exemple/webhook/…"}
          required={maskedUrl === null}
          maxLength={500}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="mt-1 block text-xs text-faint">
          {maskedUrl ? "Vide : l'adresse enregistrée est gardée. Elle n'est jamais réaffichée." : "Un nœud Webhook de n8n en POST, par exemple."}
        </span>
      </label>
      <label className="block">
        <span className="eyebrow">Jeton (facultatif)</span>
        <input
          className="field mt-1.5 block max-w-md font-mono"
          name="token"
          type="password"
          placeholder={hasToken ? "•••••••• (enregistré)" : "envoyé en « Authorization: Bearer … »"}
          maxLength={200}
          autoComplete="new-password"
          spellCheck={false}
        />
        {hasToken && (
          <span className="mt-1.5 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="clearToken" /> Retirer le jeton
          </span>
        )}
      </label>
      <fieldset>
        <legend className="eyebrow">Événements envoyés</legend>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {events.map((event) => (
            <label key={event.key} className="flex items-start gap-2 text-sm">
              <input className="mt-0.5" type="checkbox" name="events" value={event.key} defaultChecked={event.enabled} />
              <span>{event.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="eyebrow">PC muet au-delà de</span>
        <span className="mt-1.5 flex items-center gap-2 text-sm text-muted">
          <input className="field block w-20" name="silentDays" type="number" min={1} max={maxSilentDays} defaultValue={silentDays} required /> jours sans
          synchronisation
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="primary" type="submit" name="intent" value="save" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        {maskedUrl && (
          <button className="button" type="submit" name="intent" value="remove" disabled={pending} formNoValidate>
            Retirer le webhook
          </button>
        )}
        <span className="basis-full text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.saved && <span className="text-ok">Enregistré : les notifications partent dans la minute.</span>}
          {state.removed && <span className="text-ok">Webhook retiré : plus aucune notification n&apos;est envoyée.</span>}
        </span>
      </div>
    </form>
  );
}

/** Envoi d'un événement d'essai au webhook enregistré. */
export function NotifyTestForm({ action }: { action: TestAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Envoi…" : "Envoyer un essai"}
      </button>
      <span className="text-sm" role="status">
        {state.error && <span className="text-danger">{state.error}</span>}
        {state.status !== undefined && <span className="text-ok">Reçu par le webhook (HTTP {state.status}).</span>}
      </span>
    </form>
  );
}
