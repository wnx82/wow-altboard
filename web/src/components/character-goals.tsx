import { AddGoalForm, GoalTemplateForms, type GoalSuggestions } from "@/components/goal-forms";
import { Meter, SectionTitle } from "@/components/ui";
import {
  addGoalAction,
  applyTemplateAction,
  deleteGoalAction,
  deleteTemplateAction,
  moveGoalAction,
  saveTemplateAction,
  toggleGoalAction,
} from "@/lib/goals/actions";
import { formatProgress, KIND_SPECS } from "@/lib/goals/evaluate";
import type { CharacterGoal } from "@/lib/goals/store";
import { formatDateTime } from "@/lib/wow/format";

const day = new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Brussels" });

/** Section « Objectifs » de la fiche : liste ordonnée, progression, ajout et modèles. */
export function CharacterGoals({
  characterId,
  goals,
  templates,
  suggestions,
}: {
  characterId: number;
  goals: CharacterGoal[];
  templates: { id: number; name: string; goals: number }[];
  suggestions: GoalSuggestions;
}) {
  const reached = goals.filter((goal) => goal.progress.reached).length;

  return (
    <section aria-labelledby="goals" className="mt-8">
      <SectionTitle aside={goals.length > 0 ? `${reached} / ${goals.length} atteints` : undefined}>
        <span id="goals">Objectifs</span>
      </SectionTitle>
      <div className="panel p-5">
        {goals.length > 0 && <Meter value={reached} max={goals.length} label="Objectifs atteints" tone="gold" />}
        {goals.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun objectif. Ceux d&apos;une sorte automatique (niveau, métier, réputation, objet, or, monnaie) se cochent seuls à la
            synchronisation ; les autres se cochent ici.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-white/5">
            {goals.map((goal, index) => {
              const progress = formatProgress(goal.kind, goal.progress);
              return (
                <li key={goal.id} className="flex flex-wrap items-center gap-3 py-2.5" data-reached={goal.progress.reached || undefined}>
                  {goal.kind === "manual" ? (
                    <form action={toggleGoalAction}>
                      <input type="hidden" name="id" value={goal.id} />
                      <input type="hidden" name="done" value={goal.progress.reached ? "0" : "1"} />
                      <button
                        className="goal-check"
                        type="submit"
                        aria-pressed={goal.progress.reached}
                        aria-label={`${goal.progress.reached ? "Décocher" : "Cocher"} : ${goal.label}`}
                      >
                        {goal.progress.reached ? "✓" : ""}
                      </button>
                    </form>
                  ) : (
                    <span className="goal-check" data-auto aria-hidden="true" title="Se coche seul à la synchronisation">
                      {goal.progress.reached ? "✓" : ""}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={goal.progress.reached ? "text-muted line-through decoration-gold/60" : "font-medium"}>
                      {goal.label}
                      {goal.progress.reached && <span className="sr-only"> (atteint)</span>}
                    </p>
                    <p className="text-xs text-faint">
                      {KIND_SPECS[goal.kind].label}
                      {progress && <span className="tabular-nums"> · {progress}</span>}
                      {goal.achievedAt && (
                        <span title={formatDateTime(goal.achievedAt)}> · atteint le {day.format(goal.achievedAt)}</span>
                      )}
                    </p>
                    {!goal.progress.reached && goal.kind !== "reputation" && goal.progress.current !== null && goal.progress.target !== null && (
                      <div className="mt-1 max-w-xs">
                        <Meter value={Math.min(goal.progress.current, goal.progress.target)} max={goal.progress.target} label={goal.label} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={moveGoalAction}>
                      <input type="hidden" name="id" value={goal.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button className="button" type="submit" disabled={index === 0} aria-label={`Monter : ${goal.label}`}>
                        ↑
                      </button>
                    </form>
                    <form action={moveGoalAction}>
                      <input type="hidden" name="id" value={goal.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button className="button" type="submit" disabled={index === goals.length - 1} aria-label={`Descendre : ${goal.label}`}>
                        ↓
                      </button>
                    </form>
                    <form action={deleteGoalAction}>
                      <input type="hidden" name="id" value={goal.id} />
                      <button className="button" data-variant="danger" type="submit" aria-label={`Supprimer : ${goal.label}`}>
                        ×
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-5 border-t border-line pt-4">
          <AddGoalForm characterId={characterId} action={addGoalAction} suggestions={suggestions} />
        </div>
        {(templates.length > 0 || goals.length > 0) && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-2">Modèles</p>
            <GoalTemplateForms
              characterId={characterId}
              templates={templates}
              hasGoals={goals.length > 0}
              saveAction={saveTemplateAction}
              applyAction={applyTemplateAction}
              deleteAction={deleteTemplateAction}
            />
            <p className="mt-2 text-xs text-faint">
              Un modèle survit à la réinitialisation des personnages : réappliqué au personnage recréé, il n&apos;ajoute que les objectifs
              qui manquent.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
