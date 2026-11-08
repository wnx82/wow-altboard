"use client";

import { useActionState, useState } from "react";
import { GOAL_KINDS, KIND_SPECS, MAX_LABEL_LENGTH, type GoalKind } from "@/lib/goals/evaluate";
import type { GoalFormState } from "@/lib/goals/actions";
import { REACTION_LABELS } from "@/lib/wow/format";

type FormAction = (previous: GoalFormState, formData: FormData) => Promise<GoalFormState>;

/** Noms proposés pour le champ « sujet », tirés de la fiche du personnage. */
export type GoalSuggestions = { professions: string[]; factions: string[]; currencies: string[] };

function Status({ state }: { state: GoalFormState }) {
  return (
    <p className="basis-full text-xs" role="status">
      {state.error && <span className="text-danger">{state.error}</span>}
      {state.saved && <span className="text-ok">{state.saved}</span>}
    </p>
  );
}

/** Ajout d'un objectif : les champs suivent la sorte choisie. */
export function AddGoalForm({ characterId, action, suggestions }: { characterId: number; action: FormAction; suggestions: GoalSuggestions }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [kind, setKind] = useState<GoalKind>("level");
  const spec = KIND_SPECS[kind];
  const listId = `goal-subjects-${kind}`;
  const options = kind === "profession" ? suggestions.professions : kind === "reputation" ? suggestions.factions : kind === "currency" ? suggestions.currencies : [];

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="characterId" value={characterId} />
      <label className="flex flex-col gap-1 text-xs text-muted">
        Sorte
        <select className="field" name="kind" value={kind} onChange={(event) => setKind(event.target.value as GoalKind)}>
          {GOAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_SPECS[k].label}
            </option>
          ))}
        </select>
      </label>
      {spec.subject && (
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
          {spec.subject}
          <input
            className="field"
            name="subject"
            required
            maxLength={120}
            list={options.length > 0 ? listId : undefined}
            inputMode={kind === "item" ? "numeric" : undefined}
            placeholder={kind === "item" ? "2589" : undefined}
          />
          {options.length > 0 && (
            <datalist id={listId}>
              {options.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          )}
        </label>
      )}
      {spec.target &&
        (kind === "reputation" ? (
          <label className="flex flex-col gap-1 text-xs text-muted">
            {spec.target.label}
            <select className="field" name="target" defaultValue="8">
              {Object.entries(REACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex w-32 flex-col gap-1 text-xs text-muted">
            {spec.target.label}
            <input className="field" name="target" required inputMode="numeric" pattern="[0-9 ]*" />
          </label>
        ))}
      <label className="flex min-w-48 flex-[2] flex-col gap-1 text-xs text-muted">
        {kind === "manual" ? "Libellé" : "Libellé (facultatif)"}
        <input className="field" name="label" maxLength={MAX_LABEL_LENGTH} required={kind === "manual"} placeholder={kind === "manual" ? "Faire le donjon des Mortemines" : "Proposé d'après la sorte"} />
      </label>
      <button className="button" data-variant="primary" type="submit" disabled={pending}>
        {pending ? "Ajout…" : "Ajouter"}
      </button>
      <Status state={state} />
    </form>
  );
}

/** Enregistrer la liste comme modèle, appliquer ou supprimer un modèle. */
export function GoalTemplateForms({
  characterId,
  templates,
  hasGoals,
  saveAction,
  applyAction,
  deleteAction,
}: {
  characterId: number;
  templates: { id: number; name: string; goals: number }[];
  hasGoals: boolean;
  saveAction: FormAction;
  applyAction: FormAction;
  deleteAction: FormAction;
}) {
  const [saveState, save, saving] = useActionState(saveAction, {});
  const [applyState, apply, applying] = useActionState(applyAction, {});
  const [deleteState, remove, removing] = useActionState(deleteAction, {});

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {templates.length > 0 && (
        <form action={apply} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="characterId" value={characterId} />
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
            Modèle
            <select className="field" name="templateId" required>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.goals})
                </option>
              ))}
            </select>
          </label>
          <button className="button" type="submit" disabled={applying}>
            {applying ? "…" : "Appliquer"}
          </button>
          <button className="button" data-variant="danger" type="submit" formAction={remove} disabled={removing}>
            {removing ? "…" : "Supprimer le modèle"}
          </button>
          <Status state={applyState} />
          <Status state={deleteState} />
        </form>
      )}
      {hasGoals && (
        <form action={save} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="characterId" value={characterId} />
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
            Enregistrer cette liste comme modèle
            <input className="field" name="name" required maxLength={60} placeholder="Montée en niveau" />
          </label>
          <button className="button" type="submit" disabled={saving}>
            {saving ? "…" : "Enregistrer"}
          </button>
          <Status state={saveState} />
        </form>
      )}
    </div>
  );
}
