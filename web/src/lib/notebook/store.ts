import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";

// Carnet d'un personnage : une note libre et des étiquettes, saisies sur le site.

export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;
/** Proposées à la saisie, avant les étiquettes déjà employées. */
export const SUGGESTED_TAGS = ["principal", "reroll", "banque", "farm", "craft", "pvp"] as const;

export type Notebook = { note: string | null; tags: string[] };

/**
 * Étiquette telle qu'elle est gardée : espaces réduits, minuscules. Lettres (accents compris),
 * chiffres, espace, tiret et apostrophe seulement ; null si elle est vide, trop longue ou autre.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
  if (tag === "" || [...tag].length > MAX_TAG_LENGTH) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N} '’-]*$/u.test(tag) ? tag : null;
}

/** Note gardée : fins de ligne unifiées, blancs de début et de fin retirés ; null si vide. */
export function normalizeNote(raw: string): string | null {
  const note = raw.replace(/\r\n?/g, "\n").trim();
  return note === "" ? null : note;
}

export async function loadNotebook(db: DatabaseOrTransaction, characterId: number): Promise<Notebook> {
  const [[note], tags] = await Promise.all([
    db.select({ body: t.characterNotes.body }).from(t.characterNotes).where(eq(t.characterNotes.characterId, characterId)),
    db.select({ tag: t.characterTags.tag }).from(t.characterTags).where(eq(t.characterTags.characterId, characterId)).orderBy(asc(t.characterTags.createdAt), asc(t.characterTags.tag)),
  ]);
  return { note: note?.body ?? null, tags: tags.map((row) => row.tag) };
}

/** Notes et étiquettes de plusieurs personnages, pour la liste de l'accueil. */
export async function loadNotebooks(db: DatabaseOrTransaction, characterIds: number[]): Promise<Map<number, Notebook>> {
  const result = new Map<number, Notebook>();
  if (characterIds.length === 0) return result;
  const [notes, tags] = await Promise.all([
    db.select({ characterId: t.characterNotes.characterId, body: t.characterNotes.body }).from(t.characterNotes).where(inArray(t.characterNotes.characterId, characterIds)),
    db
      .select({ characterId: t.characterTags.characterId, tag: t.characterTags.tag })
      .from(t.characterTags)
      .where(inArray(t.characterTags.characterId, characterIds))
      .orderBy(asc(t.characterTags.createdAt), asc(t.characterTags.tag)),
  ]);
  const entry = (id: number) => result.get(id) ?? result.set(id, { note: null, tags: [] }).get(id)!;
  for (const row of notes) entry(row.characterId).note = row.body;
  for (const row of tags) entry(row.characterId).tags.push(row.tag);
  return result;
}

/** Étiquettes employées, de la plus courante à la plus rare. */
export async function usedTags(db: DatabaseOrTransaction): Promise<string[]> {
  const rows = await db.select({ tag: t.characterTags.tag, uses: count() }).from(t.characterTags).groupBy(t.characterTags.tag);
  return rows.sort((a, b) => b.uses - a.uses || a.tag.localeCompare(b.tag, "fr")).map((row) => row.tag);
}

/** Enregistre la note ; une note vide la supprime. */
export async function saveNote(db: DatabaseOrTransaction, characterId: number, raw: string, now: Date): Promise<{ ok: true; note: string | null } | { ok: false; error: string }> {
  const note = normalizeNote(raw);
  if (note !== null && [...note].length > MAX_NOTE_LENGTH) return { ok: false, error: `Note trop longue : ${MAX_NOTE_LENGTH} caractères au plus.` };
  if (note === null) {
    await db.delete(t.characterNotes).where(eq(t.characterNotes.characterId, characterId));
  } else {
    await db
      .insert(t.characterNotes)
      .values({ characterId, body: note, updatedAt: now })
      .onConflictDoUpdate({ target: t.characterNotes.characterId, set: { body: note, updatedAt: now } });
  }
  return { ok: true, note };
}

export async function addTag(db: DatabaseOrTransaction, characterId: number, raw: string, now: Date): Promise<{ ok: true; tag: string } | { ok: false; error: string }> {
  const tag = normalizeTag(raw);
  if (tag === null) return { ok: false, error: `Étiquette invalide : lettres, chiffres, espaces, tirets ou apostrophes, ${MAX_TAG_LENGTH} caractères au plus.` };
  const existing = await db.select({ tag: t.characterTags.tag }).from(t.characterTags).where(eq(t.characterTags.characterId, characterId));
  if (existing.some((row) => row.tag === tag)) return { ok: true, tag };
  if (existing.length >= MAX_TAGS) return { ok: false, error: `${MAX_TAGS} étiquettes au plus par personnage.` };
  await db.insert(t.characterTags).values({ characterId, tag, createdAt: now }).onConflictDoNothing();
  return { ok: true, tag };
}

export async function removeTag(db: DatabaseOrTransaction, characterId: number, tag: string): Promise<void> {
  await db.delete(t.characterTags).where(and(eq(t.characterTags.characterId, characterId), eq(t.characterTags.tag, tag)));
}

export async function characterExists(db: DatabaseOrTransaction, characterId: number): Promise<boolean> {
  const [row] = await db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.id, characterId));
  return row !== undefined;
}
