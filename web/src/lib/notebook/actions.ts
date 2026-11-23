"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { addTag, characterExists, MAX_NOTE_LENGTH, removeTag, saveNote } from "./store";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const text = (formData: FormData, name: string, max: number) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.slice(0, max) : "";
};

export type NotebookFormState = { error?: string; saved?: string };

const refresh = (characterId: number) => {
  revalidatePath(`/characters/${characterId}`);
  revalidatePath("/");
};

export async function saveNoteAction(_previous: NotebookFormState, formData: FormData): Promise<NotebookFormState> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  if (!characterId.success) return { error: "Personnage inconnu." };
  const db = getDatabase();
  if (!(await characterExists(db, characterId.data))) return { error: "Personnage inconnu." };
  // Marge pour les fins de ligne CRLF du formulaire, comptées après leur conversion : une note trop
  // longue est refusée, jamais tronquée.
  const result = await saveNote(db, characterId.data, text(formData, "note", MAX_NOTE_LENGTH * 2 + 2), new Date());
  if (!result.ok) return { error: result.error };
  refresh(characterId.data);
  return { saved: result.note === null ? "Note effacée." : "Note enregistrée." };
}

export async function addTagAction(_previous: NotebookFormState, formData: FormData): Promise<NotebookFormState> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  if (!characterId.success) return { error: "Personnage inconnu." };
  const db = getDatabase();
  if (!(await characterExists(db, characterId.data))) return { error: "Personnage inconnu." };
  const result = await addTag(db, characterId.data, text(formData, "tag", 100), new Date());
  if (!result.ok) return { error: result.error };
  refresh(characterId.data);
  return { saved: `Étiquette « ${result.tag} » ajoutée.` };
}

export async function removeTagAction(formData: FormData): Promise<void> {
  await requireSession();
  const characterId = id.safeParse(formData.get("characterId"));
  const tag = text(formData, "tag", 100);
  if (!characterId.success || tag === "") return;
  await removeTag(getDatabase(), characterId.data, tag);
  refresh(characterId.data);
}
