import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brusselsDay,
  classKey,
  classLabel,
  formatDuration,
  formatDurationToMinute,
  formatItemLevel,
  formatMoney,
  formatRelative,
  fractionalLevel,
  progressPercent,
  splitMoney,
} from "./format";

const nbsp = (text: string) => text.replace(/[  ]/g, " ");

test("l'argent en cuivre est découpé en or, argent et cuivre", () => {
  assert.deepEqual(splitMoney(80964), { gold: 8, silver: 9, copper: 64 });
  assert.equal(formatMoney(80964), "8 po 9 pa 64 pc");
  assert.equal(formatMoney(284), "2 pa 84 pc");
  assert.equal(formatMoney(7), "7 pc");
  assert.equal(formatMoney(0), "0 pc");
  assert.equal(formatMoney(10_000), "1 po 0 pa 0 pc");
  assert.equal(nbsp(formatMoney(21_474_836_470_000)), "2 147 483 647 po 0 pa 0 pc");
  assert.equal(formatMoney(null), "—");
});

test("une classe inconnue est affichée telle quelle, jamais devinée", () => {
  assert.equal(classLabel("MAGE"), "Mage");
  assert.equal(classLabel("TINKER"), "TINKER");
  assert.equal(classLabel(null), "Classe inconnue");
  assert.equal(classKey("MAGE"), "MAGE");
  assert.equal(classKey("TINKER"), "UNKNOWN");
  assert.equal(classKey(null), "UNKNOWN");
});

test("la progression est bornée et tolère les données absentes", () => {
  assert.equal(progressPercent(88, 150), 59);
  assert.equal(progressPercent(300, 150), 100);
  assert.equal(progressPercent(-5, 150), 0);
  assert.equal(progressPercent(10, 0), null);
  assert.equal(progressPercent(null, 150), null);
});

test("le niveau porte sa part d'expérience, sans jamais atteindre le niveau suivant", () => {
  assert.equal(fractionalLevel(26, 17_000, 34_000), 26.5);
  assert.equal(fractionalLevel(26, 0, 34_000), 26);
  assert.equal(fractionalLevel(26, 34_000, 34_000), 26.99);
  assert.equal(fractionalLevel(26, 99_999, 34_000), 26.99);
  // Expérience inconnue : le niveau seul, jamais une estimation.
  assert.equal(fractionalLevel(26, null, 34_000), 26);
  assert.equal(fractionalLevel(26, 500, null), 26);
  assert.equal(fractionalLevel(26, 500, 0), 26);
});

test("le niveau d'objet garde une décimale", () => {
  assert.equal(formatItemLevel(15.9375), "15,9");
  assert.equal(formatItemLevel(5), "5");
  assert.equal(formatItemLevel(null), "—");
});

test("les durées relatives sont exprimées en français", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(formatRelative(new Date("2026-10-04T11:59:40Z"), now), "à l'instant");
  assert.equal(formatRelative(new Date("2026-10-04T11:56:00Z"), now), "il y a 4 minutes");
  assert.equal(formatRelative(new Date("2026-10-04T09:00:00Z"), now), "il y a 3 heures");
  assert.equal(formatRelative(new Date("2026-10-03T12:00:00Z"), now), "hier");
  assert.equal(formatRelative(null, now), "jamais");
});

test("les durées sont lisibles à toutes les échelles", () => {
  assert.deepEqual(
    [0, 45, 60, 725, 3600, 11_100, 86_399, 86_400, 187_200].map(formatDuration),
    ["0 s", "45 s", "1 min", "12 min", "1 h", "3 h 05", "23 h 59", "1 j", "2 j 4 h"],
  );
  assert.equal(formatDuration(null), "—");
});

test("un cumul garde les minutes au-delà d'un jour", () => {
  assert.deepEqual(
    [45, 11_100, 86_399, 86_400, 187_500].map(formatDurationToMinute),
    ["45 s", "3 h 05", "23 h 59", "1 j 0 h 00", "2 j 4 h 05"],
  );
  assert.equal(formatDurationToMinute(null), "—");
});

test("le jour civil est celui de Bruxelles, heure d'été comprise", () => {
  assert.equal(brusselsDay(new Date("2026-11-08T23:30:00Z")), "2026-11-09");
  assert.equal(brusselsDay("2026-07-01T21:59:00Z"), "2026-07-01");
  assert.equal(brusselsDay("2026-07-01T22:00:00Z"), "2026-07-02");
});
