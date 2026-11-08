import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { defaultLabel, evaluateGoal, formatProgress, newlyReached, parseGoalInput, readParams, type GoalFacts } from "./evaluate";

const FACTS: GoalFacts = {
  level: 42,
  moneyCopper: 1_234_567,
  itemLevel: 38.6,
  professions: [{ name: "Couture", rank: 212 }],
  reputations: [{ name: "Hurlevent", reaction: 6 }],
  currencies: [{ name: "Insigne d'honneur", quantity: 12 }],
  items: new Map([[2589, 25]]),
};

const open = { achievedAt: null };

describe("évaluation d'un objectif", () => {
  test("chaque sorte lit sa donnée et compare à la cible", () => {
    const cases: [Parameters<typeof evaluateGoal>[0]["kind"], { target?: number; subject?: string }, number | null, boolean][] = [
      ["level", { target: 40 }, 42, true],
      ["level", { target: 60 }, 42, false],
      ["gold", { target: 123 }, 123, true],
      ["gold", { target: 124 }, 123, false],
      ["itemLevel", { target: 38 }, 38.6, true],
      ["profession", { subject: "couture", target: 300 }, 212, false],
      ["profession", { subject: "Alchimie", target: 1 }, 0, false],
      ["reputation", { subject: "HURLEVENT", target: 6 }, 6, true],
      ["reputation", { subject: "Darnassus", target: 5 }, null, false],
      ["currency", { subject: "Insigne d'honneur", target: 10 }, 12, true],
      ["item", { subject: "2589", target: 20 }, 25, true],
      ["item", { subject: "4306", target: 1 }, 0, false],
    ];
    for (const [kind, params, current, reached] of cases) {
      const progress = evaluateGoal({ kind, params, ...open }, FACTS);
      assert.deepEqual([progress.current, progress.reached], [current, reached], `${kind} ${JSON.stringify(params)}`);
    }
  });

  test("atteint une fois, toujours atteint : une dépense ne décoche pas l'objectif", () => {
    const goal = { kind: "gold" as const, params: { target: 500 }, achievedAt: new Date("2026-11-01T10:00:00Z") };
    assert.equal(evaluateGoal(goal, FACTS).reached, true);
    assert.equal(newlyReached(goal, FACTS), false);
  });

  test("seul un objectif automatique atteint et pas encore daté est à dater", () => {
    assert.equal(newlyReached({ kind: "level", params: { target: 40 }, ...open }, FACTS), true);
    assert.equal(newlyReached({ kind: "level", params: { target: 60 }, ...open }, FACTS), false);
    assert.equal(newlyReached({ kind: "manual", params: {}, ...open }, FACTS), false);
  });

  test("un objectif à cocher soi-même ne dépend que de sa date", () => {
    assert.equal(evaluateGoal({ kind: "manual", params: {}, ...open }, FACTS).reached, false);
    assert.equal(evaluateGoal({ kind: "manual", params: {}, achievedAt: new Date() }, null).reached, true);
  });

  test("sans données relevées, la progression est inconnue", () => {
    const progress = evaluateGoal({ kind: "level", params: { target: 10 }, ...open }, null);
    assert.deepEqual(progress, { current: null, target: 10, reached: false });
  });
});

describe("affichage", () => {
  test("libellés proposés et progression", () => {
    assert.equal(defaultLabel("level", { target: 60 }), "Atteindre le niveau 60");
    assert.equal(defaultLabel("reputation", { subject: "Hurlevent", target: 8 }), "Exalté auprès de : Hurlevent");
    assert.equal(defaultLabel("item", { subject: "2589", target: 20 }, "Étoffe de lin"), "Posséder 20 × Étoffe de lin");
    assert.equal(defaultLabel("item", { subject: "2589", target: 20 }), "Posséder 20 × objet 2589");
    assert.equal(formatProgress("profession", { current: 212, target: 300, reached: false }), "212 / 300");
    assert.equal(formatProgress("reputation", { current: 6, target: 8, reached: false }), "Honoré / Exalté");
    assert.equal(formatProgress("manual", { current: null, target: null, reached: true }), null);
  });
});

describe("saisie", () => {
  const raw = (fields: Partial<{ kind: string; label: string; subject: string; target: string }>) =>
    parseGoalInput({ kind: "level", label: "", subject: "", target: "", ...fields });

  test("une saisie valide est normalisée", () => {
    assert.deepEqual(raw({ target: " 60 " }), { ok: true, value: { kind: "level", params: { target: 60 }, label: null } });
    assert.deepEqual(raw({ kind: "gold", target: "1 000" }), { ok: true, value: { kind: "gold", params: { target: 1000 }, label: null } });
    assert.deepEqual(raw({ kind: "profession", subject: "  Couture ", target: "300", label: "Couture  max" }), {
      ok: true,
      value: { kind: "profession", params: { subject: "Couture", target: 300 }, label: "Couture max" },
    });
    assert.deepEqual(raw({ kind: "manual", label: "Acheter la monture" }), { ok: true, value: { kind: "manual", params: {}, label: "Acheter la monture" } });
  });

  test("les saisies invalides sont refusées avec une raison", () => {
    const refused = [
      raw({ kind: "talents" }),
      raw({ target: "0" }),
      raw({ target: "101" }),
      raw({ target: "6.5" }),
      raw({ target: "abc" }),
      raw({ kind: "reputation", subject: "Hurlevent", target: "9" }),
      raw({ kind: "profession", target: "300" }),
      raw({ kind: "item", subject: "Étoffe de lin", target: "20" }),
      raw({ kind: "manual" }),
      raw({ kind: "manual", label: "x".repeat(121) }),
    ];
    for (const result of refused) assert.equal(result.ok, false, JSON.stringify(result));
  });

  test("des paramètres relus de la base mal formés sont écartés", () => {
    assert.deepEqual(readParams({ target: 3, subject: "Couture", extra: true }), { target: 3, subject: "Couture" });
    assert.deepEqual(readParams({ target: "3", subject: 4 }), {});
    assert.deepEqual(readParams(null), {});
  });
});
