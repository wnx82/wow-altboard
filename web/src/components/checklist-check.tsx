import { toggleCheckAction } from "@/lib/checklists/actions";

/** Case d'une tâche pour un personnage : un formulaire, sans JavaScript côté navigateur. */
export function ChecklistCheck({ itemId, characterId, done, label }: { itemId: number; characterId: number; done: boolean; label: string }) {
  return (
    <form action={toggleCheckAction} className="contents">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      <button className="goal-check" type="submit" aria-pressed={done} aria-label={`${done ? "Décocher" : "Cocher"} : ${label}`}>
        {done ? "✓" : ""}
      </button>
    </form>
  );
}
