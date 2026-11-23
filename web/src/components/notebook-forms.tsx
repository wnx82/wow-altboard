"use client";

import { useActionState, useState } from "react";
import type { NotebookFormState } from "@/lib/notebook/actions";

type FormAction = (previous: NotebookFormState, formData: FormData) => Promise<NotebookFormState>;

function Status({ state }: { state: NotebookFormState }) {
  return (
    <p className="min-h-4 text-xs" role="status">
      {state.error && <span className="text-danger">{state.error}</span>}
      {state.saved && <span className="text-ok">{state.saved}</span>}
    </p>
  );
}

/** Note libre du personnage ; vide, elle est effacée. */
export function NoteForm({ characterId, note, max, action }: { characterId: number; note: string | null; max: number; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [length, setLength] = useState(note?.length ?? 0);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      // Après l'envoi, React remet le champ à la note enregistrée : le compte suit au tour suivant.
      onReset={(event) => {
        const field = event.currentTarget.elements.namedItem("note") as HTMLTextAreaElement | null;
        setTimeout(() => setLength(field?.value.length ?? 0), 0);
      }}
    >
      <input type="hidden" name="characterId" value={characterId} />
      <label className="flex flex-col gap-1 text-xs text-muted">
        Note
        <textarea
          className="field min-h-28 resize-y text-sm leading-relaxed text-text"
          name="note"
          defaultValue={note ?? ""}
          maxLength={max}
          rows={4}
          placeholder="Ce qu'il reste à faire, où il farm, ce qu'il garde en banque…"
          onChange={(event) => setLength(event.target.value.length)}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Status state={state} />
        <span className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-faint" aria-hidden="true">
            {length} / {max}
          </span>
          <button className="button" type="submit" disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer la note"}
          </button>
        </span>
      </div>
    </form>
  );
}

/** Ajout d'une étiquette : saisie libre, ou l'une des propositions. */
export function AddTagForm({ characterId, suggestions, action }: { characterId: number; suggestions: string[]; action: FormAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  const listId = `tag-suggestions-${characterId}`;

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="characterId" value={characterId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
          Nouvelle étiquette
          <input className="field" name="tag" required maxLength={24} list={listId} placeholder="principal, reroll, banque…" autoComplete="off" />
        </label>
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <button className="button" type="submit" disabled={pending}>
          Ajouter
        </button>
      </div>
      <Status state={state} />
    </form>
  );
}
