"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { writeSettings } from "@/lib/settings/store";
import { isChecklistPeriod } from "./period";
import { createItem, deleteItem, loadResetRule, MAX_LABEL_LENGTH, setCheck, updateItem } from "./store";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export type ChecklistFormState = { error?: string; saved?: string };

const refresh = (characterId?: number) => {
  revalidatePath("/checklists");
  if (characterId === undefined) revalidatePath("/characters/[id]", "page");
  else revalidatePath(`/characters/${characterId}`);
};

function readItem(formData: FormData) {
  const label = formData.get("label");
  const period = formData.get("period");
  const characterIds = formData
    .getAll("characters")
    .slice(0, 500)
    .map((value) => id.safeParse(value))
    .flatMap((result) => (result.success ? [result.data] : []));
  return {
    label: typeof label === "string" ? label.slice(0, MAX_LABEL_LENGTH * 2) : "",
    period: isChecklistPeriod(period) ? period : null,
    characterIds,
  };
}

export async function createItemAction(_previous: ChecklistFormState, formData: FormData): Promise<ChecklistFormState> {
  await requireSession();
  const input = readItem(formData);
  if (input.period === null) return { error: "Choisissez chaque jour ou chaque semaine." };
  const result = await getDatabase().transaction((tx) => createItem(tx, { ...input, period: input.period! }, new Date()));
  if (!result.ok) return { error: result.error };
  refresh();
  return { saved: "Tâche ajoutée." };
}

export async function updateItemAction(_previous: ChecklistFormState, formData: FormData): Promise<ChecklistFormState> {
  await requireSession();
  const itemId = id.safeParse(formData.get("id"));
  if (!itemId.success) return { error: "Tâche inconnue." };
  const input = readItem(formData);
  if (input.period === null) return { error: "Choisissez chaque jour ou chaque semaine." };
  const result = await getDatabase().transaction((tx) => updateItem(tx, itemId.data, { ...input, period: input.period! }, new Date()));
  if (!result.ok) return { error: result.error };
  refresh();
  return { saved: "Tâche modifiée." };
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  await requireSession();
  const itemId = id.safeParse(formData.get("id"));
  if (!itemId.success) return;
  await deleteItem(getDatabase(), itemId.data);
  refresh();
}

/** Coche ou décoche une tâche pour un personnage, pour la période en cours. */
export async function toggleCheckAction(formData: FormData): Promise<void> {
  await requireSession();
  const itemId = id.safeParse(formData.get("id"));
  const characterId = id.safeParse(formData.get("characterId"));
  if (!itemId.success || !characterId.success) return;
  const db = getDatabase();
  const done = await setCheck(db, itemId.data, characterId.data, formData.get("done") === "1", new Date(), await loadResetRule(db));
  if (done) refresh(characterId.data);
}

const hour = z.coerce.number().int().min(0).max(23);
const weekday = z.coerce.number().int().min(1).max(7);

export async function saveResetAction(_previous: ChecklistFormState, formData: FormData): Promise<ChecklistFormState> {
  await requireSession();
  const resetHour = hour.safeParse(formData.get("hour"));
  const resetWeekday = weekday.safeParse(formData.get("weekday"));
  if (!resetHour.success || !resetWeekday.success) return { error: "Heure de 0 à 23 et jour de la semaine requis." };
  await writeSettings(getDatabase(), { resetHour: resetHour.data, resetWeekday: resetWeekday.data }, new Date());
  refresh();
  return { saved: "Remise à zéro enregistrée." };
}
