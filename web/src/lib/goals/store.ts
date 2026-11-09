import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { defaultLabel, evaluateGoal, newlyReached, readKind, readParams, type GoalFacts, type GoalInput, type GoalKind, type GoalParams, type GoalProgress } from "./evaluate";

export const MAX_GOALS_PER_CHARACTER = 100;
export const MAX_TEMPLATES = 50;
export const MAX_TEMPLATE_NAME_LENGTH = 60;

export type CharacterGoal = {
  id: number;
  position: number;
  label: string;
  kind: GoalKind;
  params: GoalParams;
  achievedAt: Date | null;
  progress: GoalProgress;
};

/**
 * Données dont dépendent les objectifs automatiques, par personnage, en cinq requêtes quel que soit
 * leur nombre. Un objet compte en sacs, en banque et porté ; ses variantes (suffixe) se cumulent.
 */
export async function loadGoalFacts(db: DatabaseOrTransaction, characterIds: number[]): Promise<Map<number, GoalFacts>> {
  const facts = new Map<number, GoalFacts>();
  if (characterIds.length === 0) return facts;

  const [characters, professions, reputations, currencies, carried, worn] = await Promise.all([
    db
      .select({ id: t.characters.id, level: t.characters.level, moneyCopper: t.characters.moneyCopper, itemLevel: t.characters.itemLevel })
      .from(t.characters)
      .where(inArray(t.characters.id, characterIds)),
    db
      .select({ characterId: t.characterProfessions.characterId, name: t.characterProfessions.name, rank: t.characterProfessions.rank })
      .from(t.characterProfessions)
      .where(inArray(t.characterProfessions.characterId, characterIds)),
    db
      .select({ characterId: t.characterReputations.characterId, name: t.characterReputations.name, reaction: t.characterReputations.reaction })
      .from(t.characterReputations)
      .where(inArray(t.characterReputations.characterId, characterIds)),
    db
      .select({ characterId: t.characterCurrencies.characterId, name: t.characterCurrencies.name, quantity: t.characterCurrencies.quantity })
      .from(t.characterCurrencies)
      .where(inArray(t.characterCurrencies.characterId, characterIds)),
    db
      .select({
        characterId: t.characterItems.characterId,
        itemId: sql<number>`split_part(${t.characterItems.itemKey}, ':', 1)::int`,
        count: sql<number>`sum(${t.characterItems.quantity})::int`,
      })
      .from(t.characterItems)
      .where(inArray(t.characterItems.characterId, characterIds))
      .groupBy(t.characterItems.characterId, sql`2`),
    db
      .select({ characterId: t.characterEquipment.characterId, itemId: t.characterEquipment.itemId, count: sql<number>`count(*)::int` })
      .from(t.characterEquipment)
      .where(and(inArray(t.characterEquipment.characterId, characterIds), sql`${t.characterEquipment.itemId} is not null`))
      .groupBy(t.characterEquipment.characterId, t.characterEquipment.itemId),
  ]);

  for (const c of characters) {
    facts.set(c.id, { level: c.level, moneyCopper: c.moneyCopper, itemLevel: c.itemLevel, professions: [], reputations: [], currencies: [], items: new Map() });
  }
  for (const p of professions) facts.get(p.characterId)?.professions.push({ name: p.name, rank: p.rank });
  for (const r of reputations) facts.get(r.characterId)?.reputations.push({ name: r.name, reaction: r.reaction });
  for (const c of currencies) facts.get(c.characterId)?.currencies.push({ name: c.name, quantity: c.quantity });
  for (const item of [...carried, ...worn]) {
    const items = facts.get(item.characterId)?.items;
    if (items && item.itemId !== null) items.set(item.itemId, (items.get(item.itemId) ?? 0) + item.count);
  }
  return facts;
}

/** Objectifs d'un personnage, dans l'ordre, avec leur progression. */
export async function listCharacterGoals(db: DatabaseOrTransaction, characterId: number): Promise<CharacterGoal[]> {
  const [rows, facts] = await Promise.all([
    db.select().from(t.characterGoals).where(eq(t.characterGoals.characterId, characterId)).orderBy(asc(t.characterGoals.position), asc(t.characterGoals.id)),
    loadGoalFacts(db, [characterId]),
  ]);
  const characterFacts = facts.get(characterId) ?? null;
  return rows.map((row) => {
    const goal = { kind: readKind(row.kind), params: readParams(row.params), achievedAt: row.achievedAt };
    return { id: row.id, position: row.position, label: row.label, ...goal, progress: evaluateGoal(goal, characterFacts) };
  });
}

/**
 * Date les objectifs automatiques que les données atteignent désormais. Appelée dans la transaction
 * de synchronisation, et après un ajout ; ne lit que les personnages qui ont un objectif ouvert.
 * @returns le nombre d'objectifs datés.
 */
export async function recordAchievements(db: DatabaseOrTransaction, characterIds: number[], now: Date): Promise<number> {
  if (characterIds.length === 0) return 0;
  const open = await db
    .select({ id: t.characterGoals.id, characterId: t.characterGoals.characterId, kind: t.characterGoals.kind, params: t.characterGoals.params })
    .from(t.characterGoals)
    .where(and(inArray(t.characterGoals.characterId, characterIds), isNull(t.characterGoals.achievedAt), ne(t.characterGoals.kind, "manual")));
  if (open.length === 0) return 0;

  const facts = await loadGoalFacts(db, [...new Set(open.map((goal) => goal.characterId))]);
  const reached = open
    .filter((goal) => {
      const characterFacts = facts.get(goal.characterId);
      return characterFacts !== undefined && newlyReached({ kind: readKind(goal.kind), params: readParams(goal.params), achievedAt: null }, characterFacts);
    })
    .map((goal) => goal.id);
  if (reached.length > 0) {
    await db.update(t.characterGoals).set({ achievedAt: now, updatedAt: now }).where(inArray(t.characterGoals.id, reached));
  }
  return reached.length;
}

/**
 * Nom d'un objet, pour le libellé proposé d'un objectif « objet possédé » : celui relevé par
 * l'addon, à défaut celui de la table du jeu (objet jamais possédé).
 */
async function itemName(db: DatabaseOrTransaction, params: GoalParams): Promise<string | null> {
  const itemId = Number(params.subject);
  if (!Number.isInteger(itemId) || itemId < 1 || itemId > 2_147_483_647) return null;
  const [row] = await db
    .select({ name: t.items.name })
    .from(t.items)
    .where(and(eq(t.items.itemId, itemId), sql`${t.items.name} is not null`))
    .orderBy(asc(t.items.itemKey))
    .limit(1);
  if (row?.name) return row.name;
  const [catalog] = await db.select({ name: t.itemNames.name }).from(t.itemNames).where(eq(t.itemNames.itemId, itemId)).limit(1);
  return catalog?.name ?? null;
}

async function nextPosition(db: DatabaseOrTransaction, characterId: number): Promise<{ position: number; count: number }> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${t.characterGoals.position})`, count: sql<number>`count(*)::int` })
    .from(t.characterGoals)
    .where(eq(t.characterGoals.characterId, characterId));
  return { position: (row?.max ?? 0) + 1, count: row?.count ?? 0 };
}

export type AddResult = { ok: true; added: number } | { ok: false; error: string };

/** Ajoute des objectifs en fin de liste, puis date ceux déjà atteints. */
export async function addGoals(db: DatabaseOrTransaction, characterId: number, goals: GoalInput[], now: Date): Promise<AddResult> {
  const [character] = await db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.id, characterId));
  if (!character) return { ok: false, error: "Personnage inconnu." };
  const next = await nextPosition(db, characterId);
  const count = next.count;
  let position = next.position;
  if (count + goals.length > MAX_GOALS_PER_CHARACTER) return { ok: false, error: `${MAX_GOALS_PER_CHARACTER} objectifs au plus par personnage.` };
  if (goals.length === 0) return { ok: true, added: 0 };

  const rows = [];
  for (const goal of goals) {
    const label = goal.label ?? defaultLabel(goal.kind, goal.params, goal.kind === "item" ? await itemName(db, goal.params) : null);
    rows.push({ characterId, position: position++, label, kind: goal.kind, params: goal.params, createdAt: now, updatedAt: now });
  }
  await db.insert(t.characterGoals).values(rows);
  await recordAchievements(db, [characterId], now);
  return { ok: true, added: rows.length };
}

/** Coche ou décoche un objectif à cocher soi-même ; un objectif automatique ne se coche pas à la main. */
export async function setManualGoal(db: DatabaseOrTransaction, goalId: number, done: boolean, now: Date): Promise<boolean> {
  const updated = await db
    .update(t.characterGoals)
    .set({ achievedAt: done ? now : null, updatedAt: now })
    .where(and(eq(t.characterGoals.id, goalId), eq(t.characterGoals.kind, "manual")))
    .returning({ id: t.characterGoals.id });
  return updated.length > 0;
}

/** Échange la place d'un objectif avec son voisin du dessus ou du dessous. */
export async function moveGoal(db: DatabaseOrTransaction, goalId: number, direction: "up" | "down", now: Date): Promise<boolean> {
  const [goal] = await db.select().from(t.characterGoals).where(eq(t.characterGoals.id, goalId));
  if (!goal) return false;
  const siblings = await db
    .select({ id: t.characterGoals.id, position: t.characterGoals.position })
    .from(t.characterGoals)
    .where(eq(t.characterGoals.characterId, goal.characterId))
    .orderBy(asc(t.characterGoals.position), asc(t.characterGoals.id));
  const index = siblings.findIndex((sibling) => sibling.id === goalId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return false;
  // Toutes les positions renumérotées : deux objectifs de même position ne restent jamais ex æquo.
  const order = siblings.map((sibling) => sibling.id);
  [order[index], order[target]] = [order[target], order[index]];
  for (const [position, id] of order.entries()) {
    if (siblings[position].id !== id || siblings[position].position !== position + 1) {
      await db.update(t.characterGoals).set({ position: position + 1, updatedAt: now }).where(eq(t.characterGoals.id, id));
    }
  }
  return true;
}

export async function deleteGoal(db: DatabaseOrTransaction, goalId: number): Promise<boolean> {
  const deleted = await db.delete(t.characterGoals).where(eq(t.characterGoals.id, goalId)).returning({ id: t.characterGoals.id });
  return deleted.length > 0;
}

export async function listTemplates(db: DatabaseOrTransaction) {
  const [templates, items] = await Promise.all([
    db.select({ id: t.goalTemplates.id, name: t.goalTemplates.name }).from(t.goalTemplates).orderBy(asc(t.goalTemplates.name)),
    db
      .select({ templateId: t.goalTemplateItems.templateId, count: sql<number>`count(*)::int` })
      .from(t.goalTemplateItems)
      .groupBy(t.goalTemplateItems.templateId),
  ]);
  const counts = new Map(items.map((item) => [item.templateId, item.count]));
  return templates.map((template) => ({ ...template, goals: counts.get(template.id) ?? 0 }));
}

export type TemplateResult = { ok: true; id: number; goals: number } | { ok: false; error: string };

/** Enregistre les objectifs d'un personnage comme modèle, sans leurs dates : un modèle de même nom est remplacé. */
export async function saveTemplate(db: DatabaseOrTransaction, characterId: number, rawName: string, now: Date): Promise<TemplateResult> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Nom du modèle : à indiquer." };
  if (name.length > MAX_TEMPLATE_NAME_LENGTH) return { ok: false, error: `Nom du modèle : ${MAX_TEMPLATE_NAME_LENGTH} caractères au plus.` };
  const goals = await db
    .select({ label: t.characterGoals.label, kind: t.characterGoals.kind, params: t.characterGoals.params })
    .from(t.characterGoals)
    .where(eq(t.characterGoals.characterId, characterId))
    .orderBy(asc(t.characterGoals.position), asc(t.characterGoals.id));
  if (goals.length === 0) return { ok: false, error: "Aucun objectif à enregistrer comme modèle." };

  const [existing] = await db.select({ id: t.goalTemplates.id }).from(t.goalTemplates).where(eq(t.goalTemplates.name, name));
  if (!existing) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(t.goalTemplates);
    if (count >= MAX_TEMPLATES) return { ok: false, error: `${MAX_TEMPLATES} modèles au plus.` };
  }
  const [template] = existing
    ? await db.update(t.goalTemplates).set({ updatedAt: now }).where(eq(t.goalTemplates.id, existing.id)).returning({ id: t.goalTemplates.id })
    : await db.insert(t.goalTemplates).values({ name, createdAt: now, updatedAt: now }).returning({ id: t.goalTemplates.id });
  await db.delete(t.goalTemplateItems).where(eq(t.goalTemplateItems.templateId, template.id));
  await db.insert(t.goalTemplateItems).values(goals.map((goal, index) => ({ templateId: template.id, position: index + 1, ...goal })));
  return { ok: true, id: template.id, goals: goals.length };
}

/** Identité d'un objectif dans un modèle : même sorte, mêmes paramètres, même libellé. */
export const goalKey = (goal: { label: string; kind: string; params: unknown }) => JSON.stringify([goal.kind, goal.label, readParams(goal.params)]);

/**
 * Ajoute à un personnage les objectifs d'un modèle qu'il n'a pas déjà (même sorte, mêmes
 * paramètres, même libellé) : réappliquer un modèle ne crée aucun doublon.
 */
export async function applyTemplate(db: DatabaseOrTransaction, characterId: number, templateId: number, now: Date): Promise<AddResult> {
  const [items, current] = await Promise.all([
    db
      .select({ label: t.goalTemplateItems.label, kind: t.goalTemplateItems.kind, params: t.goalTemplateItems.params })
      .from(t.goalTemplateItems)
      .where(eq(t.goalTemplateItems.templateId, templateId))
      .orderBy(asc(t.goalTemplateItems.position)),
    db
      .select({ label: t.characterGoals.label, kind: t.characterGoals.kind, params: t.characterGoals.params })
      .from(t.characterGoals)
      .where(eq(t.characterGoals.characterId, characterId)),
  ]);
  if (items.length === 0) return { ok: false, error: "Modèle inconnu ou vide." };
  const known = new Set(current.map(goalKey));
  const missing = items
    .filter((item) => !known.has(goalKey(item)))
    .map((item): GoalInput => ({ kind: readKind(item.kind), params: readParams(item.params), label: item.label }));
  return addGoals(db, characterId, missing, now);
}

export async function deleteTemplate(db: DatabaseOrTransaction, templateId: number): Promise<boolean> {
  const deleted = await db.delete(t.goalTemplates).where(eq(t.goalTemplates.id, templateId)).returning({ id: t.goalTemplates.id });
  return deleted.length > 0;
}

/** Personnage d'un objectif : l'action revalide sa fiche. */
export async function goalCharacter(db: DatabaseOrTransaction, goalId: number): Promise<number | null> {
  const [row] = await db.select({ characterId: t.characterGoals.characterId }).from(t.characterGoals).where(eq(t.characterGoals.id, goalId));
  return row?.characterId ?? null;
}
