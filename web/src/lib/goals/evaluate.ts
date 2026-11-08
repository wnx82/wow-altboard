// Objectifs par personnage : ce qui se coche seul à partir des données synchronisées, et comment.
// Pur, sans base : appelé à la synchronisation pour dater l'atteinte et à l'affichage pour la
// progression. Règle retenue : un objectif automatique atteint une fois le reste, avec sa date,
// même si la valeur redescend ensuite (une dépense après « 100 po » ne le décoche pas).

import { REACTION_LABELS } from "@/lib/wow/format";

export const GOAL_KINDS = ["manual", "level", "profession", "reputation", "item", "gold", "itemLevel", "currency"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

/** subject : métier, faction ou monnaie (par leur nom), ou identifiant d'objet. */
export type GoalParams = { target?: number; subject?: string };

export type GoalFacts = {
  level: number | null;
  moneyCopper: number | null;
  itemLevel: number | null;
  professions: { name: string; rank: number | null }[];
  reputations: { name: string; reaction: number | null }[];
  currencies: { name: string; quantity: number }[];
  /** Exemplaires possédés par identifiant d'objet : sacs, banque et équipement. */
  items: Map<number, number>;
};

export type GoalProgress = { current: number | null; target: number | null; reached: boolean };

type KindSpec = {
  label: string;
  /** Ce que désigne `subject`, s'il en faut un. */
  subject?: string;
  /** Ce que désigne `target`, s'il en faut un, et ses bornes. */
  target?: { label: string; min: number; max: number };
};

export const KIND_SPECS: Record<GoalKind, KindSpec> = {
  manual: { label: "À cocher soi-même" },
  level: { label: "Niveau", target: { label: "Niveau", min: 1, max: 100 } },
  profession: { label: "Métier", subject: "Métier", target: { label: "Rang", min: 1, max: 1_000 } },
  reputation: { label: "Réputation", subject: "Faction", target: { label: "Palier", min: 1, max: 8 } },
  item: { label: "Objet possédé", subject: "Identifiant de l'objet", target: { label: "Exemplaires", min: 1, max: 100_000 } },
  gold: { label: "Or", target: { label: "Pièces d'or", min: 1, max: 1_000_000 } },
  itemLevel: { label: "Niveau d'objet moyen", target: { label: "Niveau d'objet", min: 1, max: 1_000 } },
  currency: { label: "Monnaie", subject: "Monnaie", target: { label: "Quantité", min: 1, max: 10_000_000 } },
};

const sameName = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;

/** Valeur courante de l'objectif automatique ; null si la donnée n'a jamais été relevée. */
function currentValue(kind: GoalKind, params: GoalParams, facts: GoalFacts): number | null {
  const subject = params.subject ?? "";
  switch (kind) {
    case "manual":
      return null;
    case "level":
      return facts.level;
    case "gold":
      return facts.moneyCopper === null ? null : Math.floor(facts.moneyCopper / 10_000);
    case "itemLevel":
      return facts.itemLevel;
    // Métier non appris, monnaie ou objet absents : zéro, pas « inconnu ».
    case "profession":
      return facts.professions.find((p) => sameName(p.name, subject))?.rank ?? 0;
    case "currency":
      return facts.currencies.find((c) => sameName(c.name, subject))?.quantity ?? 0;
    case "item":
      return facts.items.get(Number(subject)) ?? 0;
    // Une faction jamais rencontrée n'a pas de palier.
    case "reputation":
      return facts.reputations.find((r) => sameName(r.name, subject))?.reaction ?? null;
  }
}

/**
 * Progression d'un objectif. Un objectif à cocher soi-même, ou automatique déjà atteint, l'est
 * par sa date ; sinon il l'est quand la valeur courante atteint la cible.
 */
export function evaluateGoal(goal: { kind: GoalKind; params: GoalParams; achievedAt: Date | null }, facts: GoalFacts | null): GoalProgress {
  const target = goal.params.target ?? null;
  const current = facts ? currentValue(goal.kind, goal.params, facts) : null;
  if (goal.kind === "manual") return { current: null, target: null, reached: goal.achievedAt !== null };
  const reachedNow = current !== null && target !== null && current >= target;
  return { current, target, reached: goal.achievedAt !== null || reachedNow };
}

/** Atteint à l'instant d'après les données, et pas encore daté : à dater maintenant. */
export function newlyReached(goal: { kind: GoalKind; params: GoalParams; achievedAt: Date | null }, facts: GoalFacts): boolean {
  return goal.kind !== "manual" && goal.achievedAt === null && evaluateGoal(goal, facts).reached;
}

const integer = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 });

/** Libellé proposé quand le joueur n'en saisit pas. */
export function defaultLabel(kind: GoalKind, params: GoalParams, itemName?: string | null): string {
  const target = params.target ?? 0;
  const subject = params.subject ?? "";
  switch (kind) {
    case "manual":
      return "Objectif";
    case "level":
      return `Atteindre le niveau ${target}`;
    case "profession":
      return `${subject} au rang ${target}`;
    case "reputation":
      return `${REACTION_LABELS[target] ?? `Palier ${target}`} auprès de : ${subject}`;
    case "item":
      return `Posséder ${integer.format(target)} × ${itemName ?? `objet ${subject}`}`;
    case "gold":
      return `Réunir ${integer.format(target)} po`;
    case "itemLevel":
      return `Niveau d'objet moyen ${target}`;
    case "currency":
      return `${integer.format(target)} × ${subject}`;
  }
}

/** Valeur affichée d'une progression : « 212 / 300 », un palier de réputation par son nom. */
export function formatProgress(kind: GoalKind, progress: GoalProgress): string | null {
  if (kind === "manual" || progress.target === null) return null;
  if (kind === "reputation") {
    const name = (value: number | null) => (value === null ? "—" : (REACTION_LABELS[value] ?? String(value)));
    return `${name(progress.current)} / ${name(progress.target)}`;
  }
  const value = (n: number | null) => (n === null ? "—" : integer.format(n));
  return `${value(progress.current)} / ${value(progress.target)}${kind === "gold" ? " po" : ""}`;
}

export type GoalInput = { kind: GoalKind; params: GoalParams; label: string | null };
export type GoalInputResult = { ok: true; value: GoalInput } | { ok: false; error: string };

export const MAX_LABEL_LENGTH = 120;
const MAX_SUBJECT_LENGTH = 120;

/** Saisie du formulaire d'ajout, validée : sorte connue, cible entière dans ses bornes, sujet requis. */
export function parseGoalInput(raw: { kind: string; label: string; subject: string; target: string }): GoalInputResult {
  const kind = GOAL_KINDS.find((k) => k === raw.kind);
  if (!kind) return { ok: false, error: "Sorte d'objectif inconnue." };
  const spec = KIND_SPECS[kind];
  const label = raw.label.trim().replace(/\s+/g, " ");
  if (label.length > MAX_LABEL_LENGTH) return { ok: false, error: `Libellé limité à ${MAX_LABEL_LENGTH} caractères.` };
  if (kind === "manual") {
    return label ? { ok: true, value: { kind, params: {}, label } } : { ok: false, error: "Un objectif à cocher soi-même a besoin d'un libellé." };
  }

  const params: GoalParams = {};
  if (spec.subject) {
    const subject = raw.subject.trim().replace(/\s+/g, " ");
    if (!subject) return { ok: false, error: `${spec.subject} : à indiquer.` };
    if (subject.length > MAX_SUBJECT_LENGTH) return { ok: false, error: `${spec.subject} : ${MAX_SUBJECT_LENGTH} caractères au plus.` };
    if (kind === "item" && !/^[1-9]\d{0,8}$/.test(subject)) return { ok: false, error: "Identifiant de l'objet : un nombre entier (celui du lien de l'objet)." };
    params.subject = subject;
  }
  if (spec.target) {
    const text = raw.target.trim().replace(/[\s ]/g, "");
    const target = /^\d{1,9}$/.test(text) ? Number(text) : NaN;
    if (!Number.isInteger(target) || target < spec.target.min || target > spec.target.max) {
      return { ok: false, error: `${spec.target.label} : un entier de ${spec.target.min} à ${integer.format(spec.target.max)}.` };
    }
    params.target = target;
  }
  return { ok: true, value: { kind, params, label: label || null } };
}

/** Paramètres relus de la base : tout ce qui n'a pas la bonne forme est écarté. */
export function readParams(value: unknown): GoalParams {
  if (typeof value !== "object" || value === null) return {};
  const { target, subject } = value as Record<string, unknown>;
  return {
    ...(typeof target === "number" && Number.isInteger(target) ? { target } : {}),
    ...(typeof subject === "string" ? { subject } : {}),
  };
}

export function readKind(value: string): GoalKind {
  return GOAL_KINDS.find((k) => k === value) ?? "manual";
}
