import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { brusselsDay, buildGoldHistory, daysBetween } from "./gold-history";

describe("or cumulé", () => {
  test("jours calendaires à Bruxelles", () => {
    // 23 h 30 UTC le 8 novembre = 0 h 30 le 9 à Bruxelles (UTC+1).
    assert.equal(brusselsDay(new Date("2026-11-08T23:30:00Z")), "2026-11-09");
    assert.deepEqual(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });

  test("chaque personnage garde sa dernière valeur ; un relevé d'avant la période donne le départ", () => {
    const days = buildGoldHistory(
      [
        { characterId: 1, capturedAt: new Date("2026-10-01T10:00:00Z"), moneyCopper: 1_000 },
        { characterId: 1, capturedAt: new Date("2026-11-02T10:00:00Z"), moneyCopper: 5_000 },
        { characterId: 1, capturedAt: new Date("2026-11-02T20:00:00Z"), moneyCopper: 6_000 },
        { characterId: 2, capturedAt: new Date("2026-11-03T10:00:00Z"), moneyCopper: 300 },
        { characterId: 2, capturedAt: new Date("2026-11-03T11:00:00Z"), moneyCopper: null },
      ],
      new Date("2026-11-01T12:00:00Z"),
      new Date("2026-11-04T12:00:00Z"),
    );
    assert.deepEqual(days, [
      { day: "2026-11-01", copper: 1_000, characters: 1 },
      { day: "2026-11-02", copper: 6_000, characters: 1 },
      { day: "2026-11-03", copper: 6_300, characters: 2 },
      { day: "2026-11-04", copper: 6_300, characters: 2 },
    ]);
  });

  test("aucun jour avant le premier relevé", () => {
    const days = buildGoldHistory(
      [{ characterId: 1, capturedAt: new Date("2026-11-03T10:00:00Z"), moneyCopper: 10 }],
      new Date("2026-11-01T12:00:00Z"),
      new Date("2026-11-03T12:00:00Z"),
    );
    assert.deepEqual(days, [{ day: "2026-11-03", copper: 10, characters: 1 }]);
  });
});
