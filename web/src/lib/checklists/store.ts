import { and, asc, count, eq, inArray, lt, max, notInArray } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { readSettings } from "@/lib/settings/store";
import { type ChecklistPeriod, periodStart, resetRule, type ResetRule } from "./period";

// Listes à cocher : des tâches à refaire chaque jour ou chaque semaine, pour les personnages
// choisis. Une coche vaut pour la période en cours ; la suivante repart à zéro.

export const MAX_ITEMS = 100;
export const MAX_LABEL_LENGTH = 80;

export type ChecklistMember = { characterId: number; done: boolean };
export type ChecklistItem = { id: number; label: string; period: ChecklistPeriod; periodStart: string; members: ChecklistMember[] };

export async function loadResetRule(db: DatabaseOrTransaction): Promise<ResetRule> {
  return resetRule(await readSettings(db));
}

/** Tâches et leurs coches pour la période en cours ; `characterId` : celles d'un seul personnage. */
export async function listChecklist(db: DatabaseOrTransaction, now: Date, rule: ResetRule, characterId?: number): Promise<ChecklistItem[]> {
  const starts: Record<ChecklistPeriod, string> = { daily: periodStart("daily", now, rule), weekly: periodStart("weekly", now, rule) };
  const links = db
    .select({ itemId: t.checklistItemCharacters.itemId, characterId: t.checklistItemCharacters.characterId })
    .from(t.checklistItemCharacters)
    .where(characterId === undefined ? undefined : eq(t.checklistItemCharacters.characterId, characterId));
  const [items, members, checks] = await Promise.all([
    db.select({ id: t.checklistItems.id, label: t.checklistItems.label, period: t.checklistItems.period }).from(t.checklistItems).orderBy(asc(t.checklistItems.position), asc(t.checklistItems.id)),
    links,
    db
      .select({ itemId: t.checklistChecks.itemId, characterId: t.checklistChecks.characterId, periodStart: t.checklistChecks.periodStart })
      .from(t.checklistChecks)
      .where(and(inArray(t.checklistChecks.periodStart, [starts.daily, starts.weekly]), characterId === undefined ? undefined : eq(t.checklistChecks.characterId, characterId))),
  ]);
  const byItem = Map.groupBy(members, (member) => member.itemId);
  return items
    .filter((item) => characterId === undefined || byItem.has(item.id))
    .map((item) => {
      const period = item.period as ChecklistPeriod;
      const start = starts[period];
      const done = new Set(checks.filter((check) => check.itemId === item.id && check.periodStart === start).map((check) => check.characterId));
      return {
        id: item.id,
        label: item.label,
        period,
        periodStart: start,
        members: (byItem.get(item.id) ?? []).map((member) => ({ characterId: member.characterId, done: done.has(member.characterId) })),
      };
    });
}

type ItemInput = { label: string; period: ChecklistPeriod; characterIds: number[] };
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function readLabel(raw: string): string | null {
  const label = raw.trim().replace(/\s+/g, " ");
  return label === "" || [...label].length > MAX_LABEL_LENGTH ? null : label;
}

/** Personnages connus parmi ceux demandés, sans doublon. */
async function knownCharacters(db: DatabaseOrTransaction, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db.select({ id: t.characters.id }).from(t.characters).where(inArray(t.characters.id, unique));
  return rows.map((row) => row.id);
}

export async function createItem(db: DatabaseOrTransaction, input: ItemInput, now: Date): Promise<Result<{ id: number }>> {
  const label = readLabel(input.label);
  if (label === null) return { ok: false, error: `Intitulé requis, ${MAX_LABEL_LENGTH} caractères au plus.` };
  const characterIds = await knownCharacters(db, input.characterIds);
  if (characterIds.length === 0) return { ok: false, error: "Choisissez au moins un personnage." };
  const [{ items, last }] = await db.select({ items: count(), last: max(t.checklistItems.position) }).from(t.checklistItems);
  if (items >= MAX_ITEMS) return { ok: false, error: `${MAX_ITEMS} tâches au plus.` };
  const [item] = await db
    .insert(t.checklistItems)
    .values({ label, period: input.period, position: (last ?? -1) + 1, createdAt: now, updatedAt: now })
    .returning({ id: t.checklistItems.id });
  await db.insert(t.checklistItemCharacters).values(characterIds.map((characterId) => ({ itemId: item.id, characterId })));
  return { ok: true, id: item.id };
}

/** Change l'intitulé, la période et les personnages ; les coches des personnages retirés disparaissent. */
export async function updateItem(db: DatabaseOrTransaction, itemId: number, input: ItemInput, now: Date): Promise<Result> {
  const label = readLabel(input.label);
  if (label === null) return { ok: false, error: `Intitulé requis, ${MAX_LABEL_LENGTH} caractères au plus.` };
  const characterIds = await knownCharacters(db, input.characterIds);
  if (characterIds.length === 0) return { ok: false, error: "Choisissez au moins un personnage." };
  const updated = await db.update(t.checklistItems).set({ label, period: input.period, updatedAt: now }).where(eq(t.checklistItems.id, itemId)).returning({ id: t.checklistItems.id });
  if (updated.length === 0) return { ok: false, error: "Tâche inconnue." };
  await db.delete(t.checklistItemCharacters).where(and(eq(t.checklistItemCharacters.itemId, itemId), notInArray(t.checklistItemCharacters.characterId, characterIds)));
  await db
    .insert(t.checklistItemCharacters)
    .values(characterIds.map((characterId) => ({ itemId, characterId })))
    .onConflictDoNothing();
  return { ok: true };
}

export async function deleteItem(db: DatabaseOrTransaction, itemId: number): Promise<boolean> {
  const deleted = await db.delete(t.checklistItems).where(eq(t.checklistItems.id, itemId)).returning({ id: t.checklistItems.id });
  return deleted.length > 0;
}

/** Coche ou décoche une tâche pour un personnage, pour la période en cours. Faux si le lien n'existe pas. */
export async function setCheck(db: DatabaseOrTransaction, itemId: number, characterId: number, done: boolean, now: Date, rule: ResetRule): Promise<boolean> {
  const [item] = await db
    .select({ period: t.checklistItems.period })
    .from(t.checklistItems)
    .innerJoin(t.checklistItemCharacters, eq(t.checklistItemCharacters.itemId, t.checklistItems.id))
    .where(and(eq(t.checklistItems.id, itemId), eq(t.checklistItemCharacters.characterId, characterId)));
  if (!item) return false;
  const start = periodStart(item.period as ChecklistPeriod, now, rule);
  const key = and(eq(t.checklistChecks.itemId, itemId), eq(t.checklistChecks.characterId, characterId), eq(t.checklistChecks.periodStart, start));
  if (done) await db.insert(t.checklistChecks).values({ itemId, characterId, periodStart: start, checkedAt: now }).onConflictDoNothing();
  else await db.delete(t.checklistChecks).where(key);
  return true;
}

/** Supprime les coches des périodes commencées avant ce jour (AAAA-MM-JJ) : elles ne comptent plus. */
export async function purgeOldChecks(db: DatabaseOrTransaction, before: string): Promise<number> {
  const deleted = await db.delete(t.checklistChecks).where(lt(t.checklistChecks.periodStart, before)).returning({ itemId: t.checklistChecks.itemId });
  return deleted.length;
}
