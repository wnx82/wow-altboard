import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buckets, byCharacter, distinctDays, financePeriod, goldPerHour, periodStart, summarize, type LedgerDayRow } from "./finances";

const day = (date: string, extra: Partial<LedgerDayRow> = {}): LedgerDayRow => ({
  characterId: 1,
  machineId: 1,
  day: date,
  income: {},
  expense: {},
  transferIn: 0,
  transferOut: 0,
  lootValue: null,
  playedSeconds: null,
  ...extra,
});

describe("finances", () => {
  test("période : 30 jours par défaut, aujourd'hui compris", () => {
    assert.equal(financePeriod(undefined).key, "30");
    assert.equal(financePeriod(["7", "90"]).key, "30");
    assert.equal(financePeriod("inconnue").key, "30");
    assert.equal(periodStart(financePeriod("7"), "2026-11-09"), "2026-11-03");
    assert.equal(periodStart(financePeriod("all"), "2026-11-09"), null);
  });

  test("totaux par source ; les transferts entre personnages restent à part", () => {
    const totals = summarize([
      day("2026-11-01", { income: { quest: 800, loot: 200 }, expense: { repair: 300 }, transferOut: 5000, lootValue: 2629, playedSeconds: 3600 }),
      day("2026-11-01", { characterId: 2, income: { ah: 10_000 }, transferIn: 5000, playedSeconds: 1800 }),
      day("2026-11-02", { expense: { training: 1940, other: 60 } }),
    ]);

    assert.deepEqual(
      [totals.income, totals.expense, totals.net, totals.transferIn, totals.transferOut, totals.lootValue, totals.playedSeconds, totals.days],
      [11_000, 2300, 8700, 5000, 5000, 2629, 5400, 2],
    );
    assert.deepEqual([totals.incomeBySource.ah, totals.incomeBySource.quest, totals.incomeBySource.vendor], [10_000, 800, 0]);
    assert.deepEqual([totals.expenseBySource.training, totals.expenseBySource.repair], [1940, 300]);
  });

  test("bilan par heure : pas en deçà d'une demi-heure de jeu, négatif s'il le faut", () => {
    assert.equal(goldPerHour({ net: 10_000, playedSeconds: 1799 }), null);
    assert.equal(goldPerHour({ net: 10_000, playedSeconds: 1800 }), 20_000);
    assert.equal(goldPerHour({ net: -3000, playedSeconds: 7200 }), -1500);
  });

  test("une même journée copiée d'un PC à l'autre n'est comptée qu'une fois ; deux PC qui ont joué s'additionnent", () => {
    const played = day("2026-11-01", { income: { quest: 800, loot: 1 }, playedSeconds: 600 });
    const rows = distinctDays([
      played,
      { ...played, machineId: 2, income: { loot: 1, quest: 800 } },
      { ...played, machineId: 3, playedSeconds: 900 },
    ]);

    assert.deepEqual(rows.map((row) => row.machineId), [1, 3]);
    assert.equal(summarize(rows).income, 1602);
  });

  test("par personnage : le meilleur bilan d'abord", () => {
    const result = byCharacter([
      day("2026-11-01", { characterId: 1, income: { quest: 100 } }),
      day("2026-11-01", { characterId: 2, income: { ah: 900 }, expense: { ah: 100 } }),
      day("2026-11-02", { characterId: 1, expense: { repair: 300 } }),
    ]);

    assert.deepEqual(
      result.map((entry) => [entry.characterId, entry.totals.net]),
      [
        [2, 800],
        [1, -200],
      ],
    );
  });

  test("par jour : chaque jour de la période, joué ou non", () => {
    const series = buckets([day("2026-11-03", { income: { quest: 50 }, expense: { repair: 20 }, playedSeconds: 60 })], "day", "2026-11-02", "2026-11-04");

    assert.deepEqual(series, [
      { key: "2026-11-02", income: 0, expense: 0, net: 0, playedSeconds: 0, days: 0 },
      { key: "2026-11-03", income: 50, expense: 20, net: 30, playedSeconds: 60, days: 1 },
      { key: "2026-11-04", income: 0, expense: 0, net: 0, playedSeconds: 0, days: 0 },
    ]);
  });

  test("par mois : du premier mois connu au mois en cours, à cheval sur l'année", () => {
    const series = buckets(
      [day("2025-11-20", { income: { quest: 10 } }), day("2025-11-21", { income: { quest: 5 } }), day("2026-01-05", { characterId: 2, income: { ah: 7 } })],
      "month",
      null,
      "2026-02-01",
    );

    assert.deepEqual(
      series.map((bucket) => [bucket.key, bucket.income, bucket.days]),
      [
        ["2025-11", 15, 2],
        ["2025-12", 0, 0],
        ["2026-01", 7, 1],
        ["2026-02", 0, 0],
      ],
    );
  });
});
