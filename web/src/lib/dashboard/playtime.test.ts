import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hourlyHeatmap, playtimeByAccount, weekOf, weeklySummary, type SessionFact } from "./playtime";

const session = (startedAt: string, durationSeconds: number | null, extra: Partial<SessionFact> = {}): SessionFact => ({
  characterId: 1,
  startedAt: new Date(startedAt),
  durationSeconds,
  xpGained: null,
  levels: null,
  tag: null,
  ...extra,
});

describe("temps de jeu", () => {
  test("par compte : les personnages sans mesure sont comptés à part", () => {
    assert.deepEqual(
      playtimeByAccount([
        { characterId: 1, accountId: 10, accountLabel: "A", totalSeconds: 3_600 },
        { characterId: 2, accountId: 10, accountLabel: "A", totalSeconds: null },
        { characterId: 3, accountId: 20, accountLabel: "B", totalSeconds: 7_200 },
      ]),
      [
        { accountId: 20, label: "B", seconds: 7_200, characters: 1, unmeasured: 0 },
        { accountId: 10, label: "A", seconds: 3_600, characters: 2, unmeasured: 1 },
      ],
    );
  });

  test("semaine commençant le lundi, à Bruxelles", () => {
    // Dimanche 8 novembre 23 h 30 à Bruxelles : encore la semaine du lundi 2.
    assert.equal(weekOf(new Date("2026-11-08T22:30:00Z")), "2026-11-02");
    // Lundi 9 novembre 0 h 30 à Bruxelles.
    assert.equal(weekOf(new Date("2026-11-08T23:30:00Z")), "2026-11-09");
  });

  test("résumé par semaine, de la plus récente à la plus ancienne, vides gardées entre deux semaines jouées", () => {
    const weeks = weeklySummary(
      [
        session("2026-11-09T18:00:00Z", 3_600, { xpGained: 500, levels: 1, tag: "Leveling" }),
        session("2026-11-10T18:00:00Z", 1_800, { xpGained: 100, tag: "Farming" }),
        session("2026-10-27T18:00:00Z", 600, { tag: "Leveling" }),
      ],
      new Date("2026-11-11T12:00:00Z"),
      5,
    );
    assert.deepEqual(
      weeks.map((week) => [week.week, week.seconds, week.sessions, week.xp, week.levels]),
      [
        ["2026-11-09", 5_400, 2, 600, 1],
        ["2026-11-02", 0, 0, 0, 0],
        ["2026-10-26", 600, 1, 0, 0],
      ],
    );
    // Rien avant le 26 octobre : les semaines du 19 et du 12 ne sont pas listées.
    assert.deepEqual(weeklySummary([], new Date("2026-11-11T12:00:00Z"), 5).map((week) => week.week), ["2026-11-09"]);
    assert.deepEqual([...weeks[0].byTag], [
      ["Leveling", 3_600],
      ["Farming", 1_800],
    ]);
  });

  test("carte jour × heure : une session répartie sur les heures qu'elle traverse", () => {
    // Lundi 9 novembre, 20 h 30 à Bruxelles, 1 h 30 de jeu.
    const grid = hourlyHeatmap([session("2026-11-09T19:30:00Z", 5_400), session("2026-11-01T10:00:00Z", 600)], new Date("2026-11-02T00:00:00Z"));
    assert.equal(grid[0][20], 1_800);
    assert.equal(grid[0][21], 3_600);
    assert.equal(grid.flat().reduce((sum, seconds) => sum + seconds, 0), 5_400);
  });
});
