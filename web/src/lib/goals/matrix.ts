import { asc, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { evaluateGoal, formatProgress, readKind, readParams, type GoalKind } from "./evaluate";
import { goalKey, loadGoalFacts } from "./store";

// Page Objectifs : chaque modèle en tableau, ses objectifs en colonnes et les personnages qui l'ont
// appliqué en lignes. Un objectif d'un personnage relève d'un modèle quand il en a la même sorte,
// les mêmes paramètres et le même libellé (règle de applyTemplate).

export type MatrixCharacter = { id: number; name: string; class: string | null; level: number | null };
export type MatrixCell = { reached: boolean; achievedAt: Date | null; progress: string | null } | null;
export type MatrixRow = { character: MatrixCharacter; cells: MatrixCell[]; done: number; assigned: number };
export type TemplateMatrix = { id: number; name: string; items: { label: string; kind: GoalKind }[]; rows: MatrixRow[] };

/** Tous les modèles, par nom ; dans chacun, les personnages du plus avancé au moins avancé. */
export async function templateMatrices(db: Database): Promise<TemplateMatrix[]> {
  const [templates, items, goals] = await Promise.all([
    db.select({ id: t.goalTemplates.id, name: t.goalTemplates.name }).from(t.goalTemplates).orderBy(asc(t.goalTemplates.name)),
    db.select().from(t.goalTemplateItems).orderBy(asc(t.goalTemplateItems.templateId), asc(t.goalTemplateItems.position)),
    db.select().from(t.characterGoals),
  ]);
  if (templates.length === 0) return [];

  const characterIds = [...new Set(goals.map((goal) => goal.characterId))];
  const [characters, facts] = await Promise.all([
    characterIds.length === 0
      ? []
      : db
          .select({ id: t.characters.id, name: t.characters.name, class: t.characters.class, level: t.characters.level })
          .from(t.characters)
          .where(inArray(t.characters.id, characterIds)),
    loadGoalFacts(db, characterIds),
  ]);
  const goalsByCharacter = Map.groupBy(goals, (goal) => goal.characterId);
  const itemsByTemplate = Map.groupBy(items, (item) => item.templateId);

  return templates.map((template) => {
    const templateItems = itemsByTemplate.get(template.id) ?? [];
    const keys = templateItems.map(goalKey);
    const rows: MatrixRow[] = [];
    for (const character of characters) {
      const byKey = new Map((goalsByCharacter.get(character.id) ?? []).map((goal) => [goalKey(goal), goal]));
      const cells: MatrixCell[] = keys.map((key) => {
        const goal = byKey.get(key);
        if (!goal) return null;
        const kind = readKind(goal.kind);
        const progress = evaluateGoal({ kind, params: readParams(goal.params), achievedAt: goal.achievedAt }, facts.get(character.id) ?? null);
        return { reached: progress.reached, achievedAt: goal.achievedAt, progress: formatProgress(kind, progress) };
      });
      const assigned = cells.filter((cell) => cell !== null).length;
      if (assigned === 0) continue;
      rows.push({ character, cells, assigned, done: cells.filter((cell) => cell?.reached).length });
    }
    rows.sort((a, b) => b.done / b.assigned - a.done / a.assigned || (b.character.level ?? 0) - (a.character.level ?? 0) || a.character.name.localeCompare(b.character.name, "fr"));
    return { id: template.id, name: template.name, items: templateItems.map((item) => ({ label: item.label, kind: readKind(item.kind) })), rows };
  });
}
