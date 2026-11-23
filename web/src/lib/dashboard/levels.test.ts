import assert from "node:assert/strict";
import { test } from "node:test";
import { brusselsDay } from "@/lib/wow/format";
import { buildLevelProgress, dayTicks, type LevelRow } from "./levels";

const CHARACTERS: Record<number, string> = { 1: "Aedot", 2: "Brumelle", 3: "Cendrine" };
const row = (characterId: number, capturedAt: string, level: number, xp: number | null = null, xpMax: number | null = null): LevelRow => ({
  characterId,
  name: CHARACTERS[characterId],
  class: "MAGE",
  account: "Compte principal",
  capturedAt: new Date(capturedAt),
  level,
  xp,
  xpMax,
});

// Minuit du 5 septembre, heure de Bruxelles (UTC+2 en été).
const SINCE = new Date("2026-09-04T22:00:00Z");
const NOW = new Date("2026-10-04T14:00:00Z");

test("chaque personnage part de son dernier relevé d'avant la période, et ses niveaux gagnés sont comptés par jour", () => {
  const progress = buildLevelProgress(
    [
      row(1, "2026-08-01T10:00:00Z", 8),
      row(1, "2026-09-01T10:00:00Z", 10, 400, 1000),
      row(1, "2026-09-10T10:00:00Z", 12, 50, 100),
      row(1, "2026-09-10T18:00:00Z", 13),
      row(1, "2026-09-20T10:00:00Z", 13, 500, 1000),
      // Aucun relevé dans la période : présent, sans progression.
      row(2, "2026-07-01T10:00:00Z", 5),
      // Découvert pendant la période : son premier niveau relevé n'est pas un gain.
      row(3, "2026-09-12T10:00:00Z", 30),
      row(3, "2026-09-15T10:00:00Z", 31),
    ],
    SINCE,
    NOW,
  );

  assert.equal(progress.unit, "day");
  assert.deepEqual([progress.buckets[0].start, progress.buckets.at(-1)!.start, progress.buckets.length], ["2026-09-05", "2026-10-04", 30]);
  assert.deepEqual(
    progress.series.map((entry) => [entry.name, entry.startLevel, entry.endLevel, entry.gained, entry.progressed]),
    [
      ["Aedot", 10, 13, 3, true],
      ["Cendrine", 30, 31, 1, true],
      ["Brumelle", 5, 5, 0, false],
    ],
  );
  assert.equal(progress.totalGained, 4);

  const [aedot, , brumelle] = progress.series;
  assert.deepEqual(
    aedot.points.map((point) => [point.at.toISOString(), point.value, point.percent, point.carried]),
    [
      ["2026-09-04T22:00:00.000Z", 10.4, 40, true],
      ["2026-09-10T10:00:00.000Z", 12.5, 50, false],
      ["2026-09-10T18:00:00.000Z", 13, null, false],
      ["2026-09-20T10:00:00.000Z", 13.5, 50, false],
    ],
  );
  assert.equal(aedot.points[0].observedAt.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.equal(aedot.lastLevelUpAt?.toISOString(), "2026-09-10T18:00:00.000Z");
  assert.deepEqual(brumelle.points.map((point) => [point.level, point.carried]), [[5, true]]);
  assert.equal(brumelle.lastLevelUpAt, null);

  // Deux gains du même personnage le même jour : une seule ligne, du niveau de départ au dernier atteint.
  assert.deepEqual(
    progress.buckets.filter((bucket) => bucket.gained > 0).map((bucket) => [bucket.start, bucket.gained, bucket.details.map((detail) => `${detail.name} ${detail.from}→${detail.to}`)]),
    [
      ["2026-09-10", 3, ["Aedot 10→13"]],
      ["2026-09-15", 1, ["Cendrine 30→31"]],
    ],
  );
});

test("un niveau gagné après minuit, heure de Bruxelles, compte pour le jour qui commence", () => {
  const progress = buildLevelProgress([row(1, "2026-09-09T12:00:00Z", 20), row(1, "2026-09-09T22:30:00Z", 21)], SINCE, NOW);

  assert.deepEqual(progress.buckets.filter((bucket) => bucket.gained > 0).map((bucket) => bucket.start), ["2026-09-10"]);
});

test("sans date de début, la période part du premier relevé ; au-delà d'un mois les gains sont comptés par semaine", () => {
  const progress = buildLevelProgress(
    [
      // Mercredi 5 août.
      row(1, "2026-08-05T09:00:00Z", 10),
      row(1, "2026-08-20T09:00:00Z", 11),
      row(1, "2026-08-20T20:00:00Z", 13, 10, 100),
      row(1, "2026-09-30T20:00:00Z", 14),
    ],
    null,
    NOW,
  );

  assert.equal(progress.from.toISOString(), "2026-08-05T09:00:00.000Z");
  assert.equal(progress.unit, "week");
  // Les semaines commencent le lundi.
  assert.deepEqual(progress.buckets.map((bucket) => bucket.start).slice(0, 3), ["2026-08-03", "2026-08-10", "2026-08-17"]);
  assert.equal(progress.buckets.at(-1)!.start, "2026-09-28");
  assert.deepEqual(
    progress.buckets.filter((bucket) => bucket.gained > 0).map((bucket) => [bucket.start, bucket.gained]),
    [
      ["2026-08-17", 3],
      ["2026-09-28", 1],
    ],
  );
  // Un point par jour : le dernier relevé du 20 août.
  assert.deepEqual(progress.series[0].points.map((point) => point.value), [10, 13.1, 14]);
  assert.equal(progress.series[0].points.some((point) => point.carried), false);
});

test("au-delà de six mois les gains sont comptés par mois, d'une année à l'autre", () => {
  const progress = buildLevelProgress([row(1, "2025-11-20T10:00:00Z", 1), row(1, "2026-01-02T10:00:00Z", 4)], null, NOW);

  assert.equal(progress.unit, "month");
  assert.deepEqual(progress.buckets.map((bucket) => bucket.start).slice(0, 4), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  assert.equal(progress.buckets.at(-1)!.start, "2026-10-01");
  assert.deepEqual(progress.buckets.find((bucket) => bucket.gained > 0), { start: "2026-01-01", gained: 3, details: [{ id: 1, name: "Aedot", from: 1, to: 4 }] });
});

test("un niveau en baisse ne retire rien : le compte repart du nouveau niveau", () => {
  const progress = buildLevelProgress(
    [row(1, "2026-09-06T10:00:00Z", 40), row(1, "2026-09-07T10:00:00Z", 2), row(1, "2026-09-08T10:00:00Z", 5)],
    SINCE,
    NOW,
  );

  assert.deepEqual([progress.series[0].startLevel, progress.series[0].endLevel, progress.series[0].gained], [40, 5, 3]);
  assert.equal(progress.totalGained, 3);
});

test("un relevé daté après maintenant (horloge du PC en avance) reste dans la période", () => {
  const progress = buildLevelProgress([row(1, "2026-10-01T10:00:00Z", 9), row(1, "2026-10-05T08:00:00Z", 10)], SINCE, NOW);

  assert.equal(progress.to.toISOString(), "2026-10-05T08:00:00.000Z");
  assert.deepEqual([progress.buckets.at(-1)!.start, progress.buckets.at(-1)!.gained], ["2026-10-05", 1]);
});

test("aucun relevé : aucune courbe, mais la période garde ses tranches", () => {
  const progress = buildLevelProgress([], SINCE, NOW);

  assert.deepEqual([progress.series.length, progress.totalGained, progress.buckets.length], [0, 0, 30]);
  assert.equal(buildLevelProgress([], null, NOW).buckets.length, 1);
});

test("les graduations du temps sont des débuts de journée espacés d'un nombre rond de jours", () => {
  assert.deepEqual(
    dayTicks(SINCE, NOW).map((tick) => tick.toISOString()),
    ["2026-09-04T22:00:00.000Z", "2026-09-11T22:00:00.000Z", "2026-09-18T22:00:00.000Z", "2026-09-25T22:00:00.000Z", "2026-10-02T22:00:00.000Z"],
  );
  // Période commencée en cours de journée : la première graduation est le lendemain.
  assert.equal(dayTicks(new Date("2026-09-27T09:00:00Z"), NOW)[0].toISOString(), "2026-09-27T22:00:00.000Z");
  // Changement d'heure du 25 octobre 2026 : une graduation par jour, sans doublon ni jour sauté.
  assert.deepEqual(
    dayTicks(new Date("2026-10-20T22:00:00Z"), new Date("2026-10-28T12:00:00Z")).map((tick) => brusselsDay(new Date(tick.getTime() + 6 * 3600 * 1000))),
    ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"],
  );
  assert.ok(dayTicks(new Date("2020-01-01T00:00:00Z"), NOW).length <= 8);
});
