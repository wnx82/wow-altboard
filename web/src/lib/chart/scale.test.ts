import assert from "node:assert/strict";
import { test } from "node:test";
import { coinUnit, isLabelled, labelEvery, nearestIndex, niceStep, niceTicks, stepIndex, ticksUpTo, tooltipLeft } from "./scale";

test("graduations rondes couvrant les valeurs", () => {
  assert.deepEqual(niceTicks(0.2, 0.35, false), [0.2, 0.25, 0.3, 0.35]);
  assert.deepEqual(niceTicks(52, 60, true), [50, 55, 60]);
  assert.deepEqual(niceTicks(7, 7, true), [6, 7, 8]);
  assert.deepEqual(niceTicks(0, 0, false), [0, 1]);
});

test("pas minimal : jamais de graduations plus serrées qu'un cuivre", () => {
  // 0,1999 po et 0,2 po : un cuivre d'écart. Sans pas minimal, des pas de 0,00005 po.
  const ticks = niceTicks(0.1999, 0.2, false, 0.0001);
  assert.deepEqual(ticks, [0.1998, 0.1999, 0.2, 0.2001]);
  assert.ok(niceTicks(0.1999, 0.2, false)[1] - niceTicks(0.1999, 0.2, false)[0] < 0.0001);
});

test("graduations depuis zéro, entières pour un compte", () => {
  assert.deepEqual(ticksUpTo(0, true), [0, 1]);
  assert.deepEqual(ticksUpTo(9, false), [0, 5, 10]);
  assert.deepEqual(ticksUpTo(2, true), [0, 1, 2]);
  assert.deepEqual(ticksUpTo(0.5, true), [0, 1]);
});

test("pas rond pour une étendue", () => {
  assert.equal(niceStep(0, 4), 1);
  assert.equal(niceStep(100, 4), 25);
  assert.equal(niceStep(70, 3), 25);
});

test("unité monétaire : la plus grande pièce atteinte", () => {
  assert.deepEqual(coinUnit(12_345), { size: 10_000, suffix: " po" });
  assert.deepEqual(coinUnit(150), { size: 100, suffix: " pa" });
  assert.deepEqual(coinUnit(99), { size: 1, suffix: " pc" });
});

test("infobulle gardée dans le graphique", () => {
  assert.equal(tooltipLeft(10, 100, 500), 4);
  assert.equal(tooltipLeft(250, 100, 500), 200);
  assert.equal(tooltipLeft(495, 100, 500), 396);
});

test("étiquettes d'axe espacées, la dernière toujours présente", () => {
  assert.equal(labelEvery(["01/11", "02/11"], 100), 1);
  assert.equal(labelEvery(["01/11", "02/11"], 20), 3);
  // 8 tomberait juste avant la dernière : omise.
  const shown = Array.from({ length: 10 }, (_, index) => index).filter((index) => isLabelled(index, 10, 4));
  assert.deepEqual(shown, [0, 4, 9]);
});

test("point le plus proche du pointeur", () => {
  assert.equal(nearestIndex([10, 50, 90], 62), 1);
  assert.equal(nearestIndex([10, 50, 90], 89), 2);
  assert.equal(nearestIndex([10], 400), 0);
});

test("navigation au clavier : voisins, extrémités, sortie", () => {
  assert.equal(stepIndex("ArrowRight", null, 5), 4);
  assert.equal(stepIndex("ArrowLeft", null, 5), 4);
  assert.equal(stepIndex("ArrowLeft", 2, 5), 1);
  assert.equal(stepIndex("ArrowRight", 4, 5), 4);
  assert.equal(stepIndex("ArrowLeft", 0, 5), 0);
  assert.equal(stepIndex("Home", 3, 5), 0);
  assert.equal(stepIndex("End", 0, 5), 4);
  assert.equal(stepIndex("Escape", 2, 5), null);
  assert.equal(stepIndex("Tab", 2, 5), undefined);
  assert.equal(stepIndex("ArrowRight", null, 0), undefined);
});
