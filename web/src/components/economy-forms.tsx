"use client";

import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import type { AlertsState, AssistantState, DailyAuditState, DeleteAlertState, EconomySettingsState, FarmState, ItemNamesState } from "@/lib/economy/actions";

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

type DailyAuditAction = (previous: DailyAuditState, formData: FormData) => Promise<DailyAuditState>;

/** Lance ou relance l'analyse IA du jour (audit conservé) ; la page relue affiche le texte. */
export function DailyAuditForm({ action, marketId, rewrite }: { action: DailyAuditAction; marketId: number; rewrite: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="market" value={marketId} />
      <button className="button" data-variant={rewrite ? undefined : "primary"} type="submit" disabled={pending}>
        {pending ? "Analyse en cours…" : rewrite ? "Relancer l'analyse IA" : "Lancer l'analyse IA"}
      </button>
      <span className="text-sm" role="status">
        {pending && <span className="text-muted">L&apos;IA lit les faits du moteur, jusqu&apos;à deux minutes.</span>}
        {!pending && state.error && <span className="text-danger">{state.error}</span>}
      </span>
    </form>
  );
}

type AlertsAction = (previous: AlertsState, formData: FormData) => Promise<AlertsState>;

/** Seuils d'alerte d'un objet : bas et haut, en or ou en unités ; un champ vide retire le seuil. */
export function PriceAlertForm({
  action,
  marketId,
  itemKey,
  below,
  above,
  hint,
}: {
  action: AlertsAction;
  marketId: number;
  itemKey: string;
  /** Seuils enregistrés, sous leur forme saisissable (« 12 po 50 pa ») ; vide sans seuil. */
  below: string;
  above: string;
  hint: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const entered = state.entered;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="market" value={marketId} />
      <input type="hidden" name="itemKey" value={itemKey} />
      <div className="flex flex-wrap gap-3">
        <label className="block min-w-[10rem] flex-1">
          <span className="eyebrow">Prévenir sous</span>
          <input className="field mt-1.5 block" name="below" defaultValue={entered?.below ?? below} placeholder="12 po 50 pa" maxLength={40} autoComplete="off" />
        </label>
        <label className="block min-w-[10rem] flex-1">
          <span className="eyebrow">Prévenir au-dessus de</span>
          <input className="field mt-1.5 block" name="above" defaultValue={entered?.above ?? above} placeholder="40 po" maxLength={40} autoComplete="off" />
        </label>
      </div>
      <p className="text-xs text-faint">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        <span className="text-sm" role="status">
          {state.error && <span className="text-danger">{state.error}</span>}
          {state.saved && <span className="text-ok">Alerte enregistrée.</span>}
        </span>
      </div>
    </form>
  );
}

type DeleteAlertAction = (previous: DeleteAlertState, formData: FormData) => Promise<DeleteAlertState>;

/** Retire une alerte de la liste du marché. */
export function DeleteAlertButton({ action, alertId, label }: { action: DeleteAlertAction; alertId: number; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="alertId" value={alertId} />
      <button className="button" type="submit" disabled={pending} aria-label={label} title={label}>
        {pending ? "…" : "Retirer"}
      </button>
      {state.error && (
        <span className="text-xs text-danger" role="status">
          {state.error}
        </span>
      )}
    </form>
  );
}

type ItemNamesAction = (previous: ItemNamesState, formData: FormData) => Promise<ItemNamesState>;

/** Import des noms des objets depuis wago.tools : jusqu'à une minute, plusieurs mégaoctets. */
export function ItemNamesImportForm({ action, imported }: { action: ItemNamesAction; imported: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <button className="button" data-variant={imported ? undefined : "primary"} type="submit" disabled={pending}>
        {pending ? "Import en cours…" : imported ? "Mettre à jour depuis wago.tools" : "Importer depuis wago.tools"}
      </button>
      <span className="text-sm" role="status">
        {pending && <span className="text-muted">Téléchargement de la table des objets, jusqu&apos;à une minute.</span>}
        {!pending && state.error && <span className="text-danger">{state.error}</span>}
        {!pending && state.message && <span className="text-ok">{state.message}</span>}
      </span>
    </form>
  );
}
