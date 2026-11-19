import assert from "node:assert/strict";
import { test } from "node:test";
import { niceTicks } from "./trend-chart";

test("graduations rondes couvrant les valeurs", () => {
  assert.deepEqual(niceTicks(0.2, 0.35, false), [0.2, 0.25, 0.3, 0.35]);
  assert.deepEqual(niceTicks(52, 60, true), [50, 55, 60]);
});

test("pas minimal : jamais de graduations plus serrées qu'un cuivre", () => {
  // 0,1999 po et 0,2 po : un cuivre d'écart. Sans pas minimal, des pas de 0,00005 po.
  const ticks = niceTicks(0.1999, 0.2, false, 0.0001);
  assert.deepEqual(ticks, [0.1998, 0.1999, 0.2, 0.2001]);
  assert.ok(niceTicks(0.1999, 0.2, false)[1] - niceTicks(0.1999, 0.2, false)[0] < 0.0001);
});
