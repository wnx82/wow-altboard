import assert from "node:assert/strict";
import { test } from "node:test";
import { brusselsInstant, DEFAULT_RESET, describeRule, formatReset, nextReset, periodStart, resetRule } from "./period";

const rule = DEFAULT_RESET; // 5 h, mercredi

test("période du jour : avant 5 h de Bruxelles, c'est encore celle de la veille", () => {
  // 25 novembre 2026 (mercredi), heure d'hiver : Bruxelles = UTC + 1.
  assert.equal(periodStart("daily", new Date("2026-11-25T03:59:00Z"), rule), "2026-11-24");
  assert.equal(periodStart("daily", new Date("2026-11-25T04:00:00Z"), rule), "2026-11-25");
  // Heure d'été : Bruxelles = UTC + 2, 5 h = 3 h UTC.
  assert.equal(periodStart("daily", new Date("2026-07-10T02:59:00Z"), rule), "2026-07-09");
  assert.equal(periodStart("daily", new Date("2026-07-10T03:00:00Z"), rule), "2026-07-10");
  // Minuit passé à Bruxelles, la veille en UTC.
  assert.equal(periodStart("daily", new Date("2026-11-24T23:30:00Z"), rule), "2026-11-24");
});

test("période de la semaine : du mercredi 5 h au mercredi suivant", () => {
  assert.equal(periodStart("weekly", new Date("2026-11-25T03:59:00Z"), rule), "2026-11-18");
  assert.equal(periodStart("weekly", new Date("2026-11-25T04:00:00Z"), rule), "2026-11-25");
  assert.equal(periodStart("weekly", new Date("2026-11-29T20:00:00Z"), rule), "2026-11-25"); // dimanche
  assert.equal(periodStart("weekly", new Date("2026-12-01T10:00:00Z"), rule), "2026-11-25"); // mardi
  // Réinitialisation le lundi à minuit.
  assert.equal(periodStart("weekly", new Date("2026-11-23T00:30:00Z"), { hour: 0, weekday: 1 }), "2026-11-23");
  assert.equal(periodStart("weekly", new Date("2026-11-22T22:30:00Z"), { hour: 0, weekday: 1 }), "2026-11-16");
});

test("instant d'une heure de Bruxelles, de part et d'autre des changements d'heure", () => {
  assert.equal(brusselsInstant("2026-11-25", 5).toISOString(), "2026-11-25T04:00:00.000Z");
  assert.equal(brusselsInstant("2026-07-10", 5).toISOString(), "2026-07-10T03:00:00.000Z");
  // Passage à l'heure d'été le 29 mars 2026 à 2 h : 5 h est déjà en UTC + 2.
  assert.equal(brusselsInstant("2026-03-29", 5).toISOString(), "2026-03-29T03:00:00.000Z");
  // Retour à l'heure d'hiver le 25 octobre 2026 à 3 h.
  assert.equal(brusselsInstant("2026-10-25", 5).toISOString(), "2026-10-25T04:00:00.000Z");
});

test("prochaine réinitialisation", () => {
  assert.equal(nextReset("daily", new Date("2026-11-25T03:00:00Z"), rule).toISOString(), "2026-11-25T04:00:00.000Z");
  assert.equal(nextReset("daily", new Date("2026-11-25T12:00:00Z"), rule).toISOString(), "2026-11-26T04:00:00.000Z");
  assert.equal(nextReset("weekly", new Date("2026-11-23T12:00:00Z"), rule).toISOString(), "2026-11-25T04:00:00.000Z");
  // La semaine qui enjambe le passage à l'heure d'hiver garde 5 h de Bruxelles.
  assert.equal(nextReset("weekly", new Date("2026-10-22T12:00:00Z"), rule).toISOString(), "2026-10-28T04:00:00.000Z");
});

test("réinitialisation en clair", () => {
  const now = new Date("2026-11-23T12:00:00Z"); // lundi
  assert.equal(formatReset(new Date("2026-11-23T16:00:00Z"), now), "aujourd'hui à 17 h");
  assert.equal(formatReset(new Date("2026-11-24T04:00:00Z"), now), "demain à 5 h");
  assert.equal(formatReset(new Date("2026-11-25T04:00:00Z"), now), "mercredi à 5 h");
  assert.equal(formatReset(new Date("2026-12-02T04:00:00Z"), now), "mercredi 2 décembre à 5 h");
  assert.equal(describeRule(DEFAULT_RESET), "chaque jour à 5 h, chaque semaine le mercredi");
});

test("règle : réglages absents, valeurs par défaut", () => {
  assert.deepEqual(resetRule({ resetHour: null, resetWeekday: null }), { hour: 5, weekday: 3 });
  assert.deepEqual(resetRule({ resetHour: 0, resetWeekday: 7 }), { hour: 0, weekday: 7 });
});
