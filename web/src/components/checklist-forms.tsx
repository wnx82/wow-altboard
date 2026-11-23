"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import type { ChecklistFormState } from "@/lib/checklists/actions";
import { CHECKLIST_PERIODS, type ChecklistPeriod, PERIOD_LABELS, type ResetRule, WEEKDAY_LABELS } from "@/lib/checklists/period";
import { classKey } from "@/lib/wow/format";

type FormAction = (previous: ChecklistFormState, formData: FormData) => Promise<ChecklistFormState>;

/** Personnage proposé dans le formulaire d'une tâche. */
export type ChecklistCharacter = { id: number; name: string; class: string | null; level: number | null; account: { id: number; label: string }; tags: string[] };

function Status({ state, local }: { state: ChecklistFormState; local?: string | null }) {
  return (
    <p className="min-h-4 text-xs" role="status">
      {local ? <span className="text-danger">{local}</span> : state.error && <span className="text-danger">{state.error}</span>}
      {!local && state.saved && <span className="text-ok">{state.saved}</span>}
    </p>
  );
}

const checkedCount = (form: HTMLFormElement | null) => form?.querySelectorAll<HTMLInputElement>('input[name="characters"]:checked').length ?? 0;

/**
 * Création ou modification d'une tâche : intitulé, période et personnages. Cases non contrôlées :
 * React remet le formulaire à son état initial après l'envoi (vide à la création, la tâche
 * enregistrée à la modification). Les raccourcis cochent un compte ou une étiquette d'un coup.
 */
export function ChecklistItemForm({
  action,
  characters,
  item,
  onDone,
}: {
  action: FormAction;
  characters: ChecklistCharacter[];
  item?: { id: number; label: string; period: ChecklistPeriod; characterIds: number[] };
  onDone?: () => void;
}) {
  const [count, setCount] = useState(item?.characterIds.length ?? 0);
  const [local, setLocal] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(async (previous: ChecklistFormState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result.saved) onDone?.();
    return result;
  }, {});
  const chosen = new Set(item?.characterIds ?? []);
  const accounts = [...new Map(characters.map((c) => [c.account.id, c.account.label])).entries()];
  const tags = [...new Set(characters.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b, "fr"));
  const prefix = item ? `item-${item.id}` : "new";

  const recount = (form: HTMLFormElement | null) => setCount(checkedCount(form));
  // Coche tout le groupe, ou le décoche s'il l'est déjà entièrement.
  const toggleGroup = (form: HTMLFormElement | null, ids: number[]) => {
    const boxes = [...(form?.querySelectorAll<HTMLInputElement>('input[name="characters"]') ?? [])].filter((box) => ids.includes(Number(box.value)));
    const all = boxes.every((box) => box.checked);
    for (const box of boxes) box.checked = !all;
    recount(form);
    setLocal(null);
  };

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onChange={(event) => {
        recount(event.currentTarget);
        setLocal(null);
      }}
      // L'événement précède la remise à zéro : le compte se refait au tour suivant.
      onReset={(event) => {
        const form = event.currentTarget;
        setTimeout(() => recount(form), 0);
      }}
      onSubmit={(event) => {
        if (checkedCount(event.currentTarget) === 0) {
          event.preventDefault();
          setLocal("Choisissez au moins un personnage.");
        }
      }}
    >
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
          Tâche
          <input className="field" name="label" required maxLength={80} defaultValue={item?.label} placeholder="Quête journalière de cuisine, raid Onyxia…" autoComplete="off" />
        </label>
        <fieldset className="flex flex-col gap-1 text-xs text-muted">
          <legend className="mb-1">À refaire</legend>
          <div className="segmented">
            {CHECKLIST_PERIODS.map((period) => (
              <label key={period} className="segmented-option">
                <input type="radio" name="period" value={period} defaultChecked={(item?.period ?? "daily") === period} className="sr-only" />
                <span>{PERIOD_LABELS[period]}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset>
        <legend className="flex w-full flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
          <span>
            Personnages : <span className="tabular-nums text-text">{count}</span> choisi{count > 1 ? "s" : ""}
          </span>
        </legend>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Choisir d'un coup">
          <button type="button" className="button px-2 py-1 text-xs" onClick={(event) => toggleGroup(event.currentTarget.form, characters.map((c) => c.id))}>
            Tous
          </button>
          {accounts.length > 1 &&
            accounts.map(([id, label]) => (
              <button key={id} type="button" className="button px-2 py-1 text-xs" onClick={(event) => toggleGroup(event.currentTarget.form, characters.filter((c) => c.account.id === id).map((c) => c.id))}>
                {label}
              </button>
            ))}
          {tags.map((tag) => (
            <button key={tag} type="button" className="button px-2 py-1 text-xs" onClick={(event) => toggleGroup(event.currentTarget.form, characters.filter((c) => c.tags.includes(tag)).map((c) => c.id))}>
              « {tag} »
            </button>
          ))}
        </div>
        <div className="mt-3 grid max-h-72 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => (
            <label key={character.id} htmlFor={`${prefix}-c${character.id}`} className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-white/5" data-class={classKey(character.class)}>
              <input id={`${prefix}-c${character.id}`} type="checkbox" name="characters" value={character.id} defaultChecked={chosen.has(character.id)} className="accent-[var(--gold)]" />
              <span className="min-w-0 truncate class-text">{character.name}</span>
              <span className="flex-none text-xs text-faint">{character.level ?? "—"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Status state={state} local={local} />
        <button className="button" data-variant="primary" type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : item ? "Enregistrer" : "Ajouter la tâche"}
        </button>
      </div>
    </form>
  );
}

/** Modification d'une tâche, repliée ; le formulaire n'existe qu'une fois ouvert. */
export function ChecklistItemEditor({
  action,
  deleteAction,
  characters,
  item,
}: {
  action: FormAction;
  deleteAction: (formData: FormData) => Promise<void>;
  characters: ChecklistCharacter[];
  item: { id: number; label: string; period: ChecklistPeriod; characterIds: number[] };
}) {
  const [open, setOpen] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);

  return (
    <details ref={details} className="checklist-editor" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-gold hover:underline">Modifier</summary>
      {open && (
        <div className="mt-3 rounded-xl border border-line p-4">
          <ChecklistItemForm
            action={action}
            characters={characters}
            item={item}
            onDone={() => {
              if (details.current) details.current.open = false;
            }}
          />
          <form action={deleteAction} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="text-xs text-danger hover:underline">
              Supprimer cette tâche et ses coches
            </button>
          </form>
        </div>
      )}
    </details>
  );
}

/**
 * Heure et jour des remises à zéro, heure de Bruxelles. Envoi sans la remise à zéro automatique du
 * formulaire : un select garderait sa valeur d'origine, pas celle enregistrée.
 */
export function ResetForm({ rule, action }: { rule: ResetRule; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-muted">
        Heure (Bruxelles)
        <select className="field" name="hour" defaultValue={rule.hour}>
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hour} h
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Jour de la semaine
        <select className="field" name="weekday" defaultValue={rule.weekday}>
          {WEEKDAY_LABELS.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button className="button" type="submit" disabled={pending}>
        Enregistrer
      </button>
      <div className="basis-full">
        <Status state={state} />
      </div>
    </form>
  );
}
