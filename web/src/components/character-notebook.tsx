import Link from "next/link";
import { ChecklistCheck } from "@/components/checklist-check";
import { AddTagForm, NoteForm } from "@/components/notebook-forms";
import { SectionTitle } from "@/components/ui";
import { CHECKLIST_PERIODS, formatReset, nextReset, PERIOD_LABELS, type ResetRule } from "@/lib/checklists/period";
import type { ChecklistItem } from "@/lib/checklists/store";
import { homeHref } from "@/lib/dashboard/browser-state";
import { addTagAction, removeTagAction, saveNoteAction } from "@/lib/notebook/actions";
import { MAX_NOTE_LENGTH, MAX_TAGS, type Notebook, SUGGESTED_TAGS } from "@/lib/notebook/store";

/** Section « Carnet » de la fiche : étiquettes, note libre et tâches du jour et de la semaine. */
export function CharacterNotebook({
  characterId,
  notebook,
  knownTags,
  checklist,
  rule,
  now,
}: {
  characterId: number;
  notebook: Notebook;
  /** Étiquettes déjà employées, de la plus courante à la plus rare. */
  knownTags: string[];
  checklist: ChecklistItem[];
  rule: ResetRule;
  now: Date;
}) {
  const suggestions = [...new Set([...SUGGESTED_TAGS, ...knownTags])].filter((tag) => !notebook.tags.includes(tag));
  const done = checklist.filter((item) => item.members[0]?.done).length;

  return (
    <section aria-labelledby="notebook" className="mt-8">
      <SectionTitle aside={checklist.length > 0 ? `${done} / ${checklist.length} tâches faites` : undefined}>
        <span id="notebook">Carnet</span>
      </SectionTitle>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel flex flex-col gap-4 p-5">
          <div>
            <h3 className="eyebrow">Étiquettes</h3>
            {notebook.tags.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Aucune étiquette : « principal », « reroll », « banque »… servent de filtre sur l&apos;accueil.</p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Étiquettes du personnage">
                {notebook.tags.map((tag) => (
                  <li key={tag} className="badge gap-1 pr-1" data-tone="gold">
                    <Link href={homeHref({ tag })} prefetch={false} className="hover:underline" title={`Personnages étiquetés « ${tag} »`}>
                      {tag}
                    </Link>
                    <form action={removeTagAction} className="contents">
                      <input type="hidden" name="characterId" value={characterId} />
                      <input type="hidden" name="tag" value={tag} />
                      <button type="submit" className="tag-remove" aria-label={`Retirer l'étiquette ${tag}`}>
                        ×
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {notebook.tags.length < MAX_TAGS ? (
            <AddTagForm characterId={characterId} suggestions={suggestions} action={addTagAction} />
          ) : (
            <p className="text-xs text-faint">{MAX_TAGS} étiquettes au plus : retirez-en une pour en ajouter.</p>
          )}
          <NoteForm characterId={characterId} note={notebook.note} max={MAX_NOTE_LENGTH} action={saveNoteAction} />
        </div>

        <div className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="eyebrow">Listes à cocher</h3>
            <Link href="/checklists" prefetch={false} className="text-xs text-gold hover:underline">
              Gérer les listes
            </Link>
          </div>
          {checklist.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Aucune tâche pour ce personnage. Les tâches à refaire chaque jour ou chaque semaine se créent dans{" "}
              <Link href="/checklists" prefetch={false} className="text-gold hover:underline">
                Listes
              </Link>
              .
            </p>
          ) : (
            CHECKLIST_PERIODS.map((period) => {
              const items = checklist.filter((item) => item.period === period);
              if (items.length === 0) return null;
              return (
                <div key={period} className="mt-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                    <span className="font-semibold text-text">{PERIOD_LABELS[period]}</span>
                    <span>Remise à zéro {formatReset(nextReset(period, now, rule), now)}</span>
                  </p>
                  <ul className="mt-1 divide-y divide-white/5">
                    {items.map((item) => {
                      const checked = item.members[0]?.done ?? false;
                      return (
                        <li key={item.id} className="flex items-center gap-3 py-2" data-reached={checked || undefined}>
                          <ChecklistCheck itemId={item.id} characterId={characterId} done={checked} label={item.label} />
                          <span className={checked ? "text-muted line-through decoration-gold/60" : ""}>
                            {item.label}
                            {checked && <span className="sr-only"> (fait)</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
