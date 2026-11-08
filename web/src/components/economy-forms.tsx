"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import type { AssistantState, EconomySettingsState, FarmState } from "@/lib/economy/actions";

type SettingsAction = (previous: EconomySettingsState, formData: FormData) => Promise<EconomySettingsState>;

/** Réglages du moteur économique : début de l'historique des prix et commission de l'hôtel des ventes. */
export function EconomySettingsForm({
  action,
  historyFrom,
  auctionCut,
  cutoffDay,
  today,
}: {
  action: SettingsAction;
  /** Jour enregistré (AAAA-MM-JJ), vide si la date limite des personnages s'applique. */
  historyFrom: string;
  auctionCut: string;
  /** Jour de la date limite des personnages, appliqué quand le champ est vide. */
  cutoffDay: string | null;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const entered = state.entered;

  return (
    <form action={formAction} className="space-y-4">
      <label className="block">
        <span className="eyebrow">Début de l&apos;historique des prix</span>
        <input className="field mt-1.5 block max-w-xs" type="date" name="historyFrom" max={today} defaultValue={entered?.historyFrom ?? historyFrom} />
        <span className="mt-1 block text-xs text-faint">
          Les relevés antérieurs sont ignorés par le moteur (prix de la bêta). Vide :{" "}
          {cutoffDay ? `la date limite des personnages, le ${cutoffDay}` : "tout l'historique, aucune date limite n'étant posée"}.
        </span>
      </label>
      <label className="block">
        <span className="eyebrow">Commission de l&apos;hôtel des ventes (%)</span>
        <input
          className="field mt-1.5 block max-w-[8rem]"
          name="auctionCut"
          inputMode="decimal"
          defaultValue={entered?.auctionCut ?? auctionCut}
          placeholder="5"
          autoComplete="off"
        />
        <span className="mt-1 block text-xs text-faint">Prélevée sur chaque vente. Vide : 5 %.</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        <span className="text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.saved && <span className="text-ok">Enregistré : le moteur recalcule avec ces réglages.</span>}
        </span>
      </div>
    </form>
  );
}

type FarmAction = (previous: FarmState, formData: FormData) => Promise<FarmState>;

function FarmStatus({ state }: { state: FarmState }) {
  return (
    <span className="text-sm" role="status">
      {state.error && <span className="text-danger">{state.error}</span>}
      {state.message && <span className="text-ok">{state.message}</span>}
    </span>
  );
}

/** Démarrage d'une session de farm : personnage et libellé libre (zone, métier, ressource). */
export function FarmStartForm({
  action,
  characters,
  maxLabelLength,
}: {
  action: FarmAction;
  characters: { id: number; label: string; zone: string | null }[];
  maxLabelLength: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="intent" value="start" />
      <label className="block">
        <span className="eyebrow">Personnage</span>
        <select className="field mt-1.5 block" name="characterId" required defaultValue="">
          <option value="" disabled>
            Choisir…
          </option>
          {characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-[14rem] flex-1">
        <span className="eyebrow">Libellé (zone, métier, ressource)</span>
        <input className="field mt-1.5 block" name="label" maxLength={maxLabelLength} placeholder="Minage — Gorges des Vents brûlants" autoComplete="off" />
      </label>
      <button className="button" data-variant="primary" type="submit" disabled={pending}>
        {pending ? "Démarrage…" : "Démarrer une session"}
      </button>
      <span className="basis-full">
        <FarmStatus state={state} />
      </span>
    </form>
  );
}

/** Fin ou abandon d'une session en cours. */
export function FarmSessionControls({ action, sessionId }: { action: FarmAction; sessionId: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button className="button" data-variant="primary" type="submit" name="intent" value="end" disabled={pending}>
        Terminer
      </button>
      <button className="button" type="submit" name="intent" value="cancel" disabled={pending}>
        Abandonner
      </button>
      <FarmStatus state={state} />
    </form>
  );
}

type AssistantAction = (previous: AssistantState, formData: FormData) => Promise<AssistantState>;

/** Relance la sonde du serveur de l'assistant : la page est relue sur place, sans navigation. */
export function AssistantRetryButton() {
  const router = useRouter();
  const [pending, startRefresh] = useTransition();
  return (
    <button className="button" type="button" disabled={pending} onClick={() => startRefresh(() => router.refresh())}>
      {pending ? "Vérification…" : "Réessayer"}
    </button>
  );
}

/** Question en langage naturel : la réponse ne cite que les faits du moteur, sinon elle est refusée. */
export function AssistantForm({ action, marketId, maxLength }: { action: AssistantAction; marketId: number; maxLength: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="market" value={marketId} />
      <label className="block">
        <span className="eyebrow">Question</span>
        <textarea
          className="field mt-1.5"
          name="question"
          rows={2}
          maxLength={maxLength}
          defaultValue={state.question ?? ""}
          placeholder="Quelle est l'opportunité la plus sûre ce soir ?"
          required
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Réflexion…" : "Demander"}
        </button>
        <span className="text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
        </span>
      </div>
      {state.answer && <p className="panel whitespace-pre-line p-4 text-sm">{state.answer}</p>}
    </form>
  );
}
