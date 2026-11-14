import assert from "node:assert/strict";
import { test } from "node:test";
import { buildActivity, filterActivity, isChangeKind, type ActivitySnapshot } from "./activity";
import { readRosterFilter } from "./roster-filter";

const ELODIE = { id: 1, name: "Élodie", class: "MAGE", accountId: 1, account: "Compte A" };
const AEGIR = { id: 2, name: "Ægir", class: "HUNTER", accountId: 2, account: "Compte B" };

const snapshot = (character: typeof ELODIE, capturedAt: string, level: number, moneyCopper: number): ActivitySnapshot => ({
  character,
  capturedAt: new Date(capturedAt),
  level,
  moneyCopper,
  itemLevel: null,
  data: {},
});

const SINCE = new Date("2026-10-01T00:00:00Z");

test("les changements de tous les personnages sont fusionnés, du plus récent au plus ancien", () => {
  const days = buildActivity(
    [
      // Reçus dans le désordre : l'ordre des relevés ne dépend pas de celui de la requête.
      snapshot(ELODIE, "2026-10-03T18:00:00Z", 22, 500),
      snapshot(AEGIR, "2026-10-02T09:00:00Z", 10, 100),
      snapshot(ELODIE, "2026-10-02T20:00:00Z", 21, 500),
      snapshot(AEGIR, "2026-10-03T19:30:00Z", 10, 350),
      snapshot(ELODIE, "2026-10-02T08:00:00Z", 20, 500),
    ],
    SINCE,
  );

  assert.deepEqual(
    days.map((day) => [day.day, day.entries.map((entry) => [entry.character.name, entry.changes.map((change) => change.text)])]),
    [
      [
        "2026-10-03",
        [
          ["Ægir", ["+2 pa 50 pc"]],
          ["Élodie", ["Niveau 21 → 22"]],
        ],
      ],
      ["2026-10-02", [["Élodie", ["Niveau 20 → 21"]]]],
    ],
  );
});

test("un relevé antérieur à la période sert de comparaison sans apparaître", () => {
  const days = buildActivity(
    [
      snapshot(ELODIE, "2026-07-01T10:00:00Z", 10, 0),
      snapshot(ELODIE, "2026-09-15T10:00:00Z", 15, 0),
      snapshot(ELODIE, "2026-10-05T10:00:00Z", 20, 0),
    ],
    SINCE,
  );

  // Le passage de 10 à 15 date de septembre : hors période. Celui de 15 à 20 est daté d'octobre.
  assert.deepEqual(
    days.flatMap((day) => day.entries.map((entry) => [day.day, entry.changes[0].text])),
    [["2026-10-05", "Niveau 15 → 20"]],
  );
});

test("le jour est celui de Bruxelles, pas celui d'UTC", () => {
  const days = buildActivity([snapshot(AEGIR, "2026-10-04T12:00:00Z", 10, 0), snapshot(AEGIR, "2026-10-04T22:30:00Z", 11, 0)], SINCE);

  // 22:30 UTC = 00:30 le lendemain à Bruxelles (heure d'été).
  assert.deepEqual(
    days.map((day) => day.day),
    ["2026-10-05"],
  );
});

test("sans changement lisible, il n'y a pas d'activité", () => {
  assert.deepEqual(buildActivity([snapshot(ELODIE, "2026-10-02T08:00:00Z", 20, 500), snapshot(ELODIE, "2026-10-03T08:00:00Z", 20, 500)], SINCE), []);
  assert.deepEqual(buildActivity([snapshot(ELODIE, "2026-10-02T08:00:00Z", 20, 500)], SINCE), []);
  assert.deepEqual(buildActivity([], SINCE), []);
});

test("filtre : compte, nom et type de changement ; un relevé sans changement retenu disparaît", () => {
  const days = buildActivity(
    [
      snapshot(ELODIE, "2026-10-02T08:00:00Z", 20, 500),
      snapshot(ELODIE, "2026-10-02T20:00:00Z", 21, 900),
      snapshot(AEGIR, "2026-10-02T09:00:00Z", 10, 100),
      snapshot(AEGIR, "2026-10-03T19:30:00Z", 10, 350),
    ],
    SINCE,
  );
  const texts = (result: ReturnType<typeof filterActivity>) =>
    result.map((day) => [day.day, day.entries.map((entry) => [entry.character.name, entry.changes.map((change) => change.text)])]);

  assert.deepEqual(texts(filterActivity(days, readRosterFilter({}), "level")), [["2026-10-02", [["Élodie", ["Niveau 20 → 21"]]]]]);
  assert.deepEqual(texts(filterActivity(days, readRosterFilter({ account: "2" }), null)), [["2026-10-03", [["Ægir", ["+2 pa 50 pc"]]]]]);
  assert.deepEqual(texts(filterActivity(days, readRosterFilter({ character: "elo" }), "guild")), []);
  assert.equal(isChangeKind("level"), true);
  assert.equal(isChangeKind("toString"), false);
});
