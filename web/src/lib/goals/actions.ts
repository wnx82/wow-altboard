"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { parseGoalInput } from "./evaluate";
import { addGoals, applyTemplate, deleteGoal, deleteTemplate, goalCharacter, moveGoal, saveTemplate, setManualGoal } from "./store";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const text = (formData: FormData, name: string, max: number) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
};

export type GoalFormState = { error?: string; saved?: string };

const refresh = (characterId: number) => {
  revalidatePath(`/characters/${characterId}`);
};

/** Ajoute un objectif en fin de liste ; déjà atteint d'après les données, il est coché aussitôt. */
export async function addGoalAction(_previous: GoalFormState, formData: FormData): Promise<GoalFormState> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  if (!characterId.success) return { error: "Personnage inconnu." };
  const input = parseGoalInput({
    kind: text(formData, "kind", 40),
    label: text(formData, "label", 500),
    subject: text(formData, "subject", 500),
    target: text(formData, "target", 40),
  });
  if (!input.ok) return { error: input.error };

  const db = getDatabase();
  const result = await db.transaction((tx) => addGoals(tx, characterId.data, [input.value], new Date()));
  if (!result.ok) return { error: result.error };
  refresh(characterId.data);
  return { saved: "Objectif ajouté." };
}

/** Coche ou décoche un objectif à cocher soi-même. */
export async function toggleGoalAction(formData: FormData): Promise<void> {
  await requireSession();
  const goal = id.safeParse(formData.get("id"));
  if (!goal.success) return;
  const db = getDatabase();
  const characterId = await goalCharacter(db, goal.data);
  if (characterId === null) return;
  await setManualGoal(db, goal.data, formData.get("done") === "1", new Date());
  refresh(characterId);
}

export async function moveGoalAction(formData: FormData): Promise<void> {
  await requireSession();
  const goal = id.safeParse(formData.get("id"));
  const direction = formData.get("direction");
  if (!goal.success || (direction !== "up" && direction !== "down")) return;
  const db = getDatabase();
  const characterId = await goalCharacter(db, goal.data);
  if (characterId === null) return;
  await db.transaction((tx) => moveGoal(tx, goal.data, direction, new Date()));
  refresh(characterId);
}

export async function deleteGoalAction(formData: FormData): Promise<void> {
  await requireSession();
  const goal = id.safeParse(formData.get("id"));
  if (!goal.success) return;
  const db = getDatabase();
  const characterId = await goalCharacter(db, goal.data);
  if (characterId === null) return;
  await deleteGoal(db, goal.data);
  refresh(characterId);
}

/** Enregistre la liste du personnage comme modèle ; un modèle de même nom est remplacé. */
export async function saveTemplateAction(_previous: GoalFormState, formData: FormData): Promise<GoalFormState> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  if (!characterId.success) return { error: "Personnage inconnu." };
  const result = await getDatabase().transaction((tx) => saveTemplate(tx, characterId.data, text(formData, "name", 200), new Date()));
  if (!result.ok) return { error: result.error };
  refresh(characterId.data);
  return { saved: `Modèle enregistré : ${result.goals} objectif${result.goals > 1 ? "s" : ""}.` };
}

/** Ajoute au personnage les objectifs du modèle qu'il n'a pas déjà. */
export async function applyTemplateAction(_previous: GoalFormState, formData: FormData): Promise<GoalFormState> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  const templateId = id.safeParse(formData.get("templateId"));
  if (!characterId.success) return { error: "Personnage inconnu." };
  if (!templateId.success) return { error: "Choisissez un modèle." };
  const result = await getDatabase().transaction((tx) => applyTemplate(tx, characterId.data, templateId.data, new Date()));
  if (!result.ok) return { error: result.error };
  refresh(characterId.data);
  return { saved: result.added === 0 ? "Rien à ajouter : ce personnage a déjà tous ces objectifs." : `${result.added} objectif${result.added > 1 ? "s" : ""} ajouté${result.added > 1 ? "s" : ""}.` };
}

export async function deleteTemplateAction(_previous: GoalFormState, formData: FormData): Promise<GoalFormState> {
  await requireSession();
  const templateId = id.safeParse(formData.get("templateId"));
  if (!templateId.success) return { error: "Choisissez un modèle." };
  const deleted = await deleteTemplate(getDatabase(), templateId.data);
  revalidatePath("/characters/[id]", "page");
  return deleted ? { saved: "Modèle supprimé." } : { error: "Modèle inconnu." };
}
