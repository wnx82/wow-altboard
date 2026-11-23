import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLevelTimes, cumulativePlayedSeconds, fillLevelTimes } from "./level-times";

const at = (iso: string) => new Date(iso);
const row = (level: number, playedSeconds: number | null, wallSeconds: number | null = null) => ({
  level,
  playedSeconds,
  wallSeconds,
  reachedAt: at("2026-10-04T12:00:00Z"),
  zone: "Forêt d'Elwynn",
});
const playtime = (currentLevel: number | null, total: number | null, start: number | null) => ({
  totalSeconds: total,
  measuredAt: at("2026-10-04T15:00:00Z"),
  currentLevel,
  currentLevelStartSeconds: start,
  currentLevelStartedAt: at("2026-10-04T13:00:00Z"),
});

test("les niveaux terminés sont triés et le niveau en cours est ajouté à la fin", () => {
  const levels = buildLevelTimes([row(24, 5400, 90000), row(23, 3600)], playtime(25, 100_000, 97_000), 25);

  assert.deepEqual(
    levels.map((entry) => [entry.level, entry.playedSeconds, entry.wallSeconds, entry.current]),
    [
      [23, 3600, null, false],
      [24, 5400, 90000, false],
      [25, 3000, 7200, true],
    ],
  );
  assert.equal(levels[0].reachedAt, "2026-10-04T12:00:00.000Z");
  assert.equal(levels[2].reachedAt, null);
});

test("un niveau gagné sans mesure reste présent, sans durée inventée", () => {
  const levels = buildLevelTimes([row(10, null), row(11, 1200)], null, 12);

  assert.deepEqual(levels.map((entry) => [entry.level, entry.playedSeconds]), [
    [10, null],
    [11, 1200],
  ]);
});

test("le niveau en cours n'est affiché que s'il est connu et cohérent", () => {
  assert.equal(buildLevelTimes([], null, 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(null, 100, 50), 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(25, null, 50), 25).length, 0);
  assert.equal(buildLevelTimes([], playtime(25, 100, null), 25).length, 0);
  // Relevé antérieur au passage de niveau : il décrit le niveau 24, plus le niveau actuel.
  assert.equal(buildLevelTimes([], playtime(24, 100, 50), 25).length, 0);
  // Niveau du personnage inconnu : le relevé fait foi.
  assert.deepEqual(buildLevelTimes([], playtime(24, 100, 50), null).map((entry) => [entry.level, entry.playedSeconds]), [[24, 50]]);
  // Déjà terminé : pas de doublon.
  assert.equal(buildLevelTimes([row(25, 900)], playtime(25, 100, 50), 25).length, 1);
  // Horloge incohérente : jamais de durée négative.
  assert.equal(buildLevelTimes([], playtime(25, 50, 100), 25)[0].playedSeconds, 0);
});

test("le tableau liste tous les niveaux, les non relevés sans durée", () => {
  const levels = fillLevelTimes(buildLevelTimes([row(3, 600)], playtime(5, 4000, 3000), 5), 5);

  assert.deepEqual(
    levels.map((entry) => [entry.level, entry.playedSeconds, entry.current]),
    [
      [1, null, false],
      [2, null, false],
      [3, 600, false],
      [4, null, false],
      [5, 1000, true],
    ],
  );
  assert.deepEqual([levels[0].wallSeconds, levels[0].reachedAt, levels[0].zone], [null, null, null]);
  assert.equal(levels[2].zone, "Forêt d'Elwynn");
});

test("le niveau du personnage clôt la liste, même sans relevé du niveau en cours", () => {
  // Relevé de temps de jeu antérieur au passage de niveau : le niveau en cours n'a aucune mesure.
  const levels = fillLevelTimes(buildLevelTimes([row(2, 300)], playtime(3, 900, 600), 4), 4);

  assert.deepEqual(
    levels.map((entry) => [entry.level, entry.playedSeconds, entry.current]),
    [
      [1, null, false],
      [2, 300, false],
      [3, null, false],
      [4, null, true],
    ],
  );
});

test("la liste n'est complétée que si elle a un sens", () => {
  // Aucun relevé : rien à compléter.
  assert.equal(fillLevelTimes([], 25).length, 0);
  // Niveau du personnage inconnu : jusqu'au dernier niveau relevé.
  assert.deepEqual(fillLevelTimes(buildLevelTimes([row(3, 600)], null, null), null).map((entry) => entry.level), [1, 2, 3]);
  // Niveau relevé au-delà de celui du personnage : il reste affiché.
  assert.deepEqual(fillLevelTimes(buildLevelTimes([row(3, 600)], null, 2), 2).map((entry) => entry.level), [1, 2, 3]);
  // Niveau aberrant : la liste reste celle des relevés.
  assert.deepEqual(fillLevelTimes(buildLevelTimes([row(3, 600)], null, 30_000), 30_000).map((entry) => entry.level), [3]);
});

test("le cumul est le temps de jeu total à la fin de chaque niveau", () => {
  const levels = fillLevelTimes(buildLevelTimes([row(24, 5400), row(23, 3600)], playtime(25, 100_000, 97_000), 25), 25);
  const cumulative = cumulativePlayedSeconds(levels, 100_000);

  // Remonte depuis le total : le cumul inclut le temps des niveaux non relevés, sans le leur attribuer.
  assert.deepEqual([...cumulative], [
    [25, 100_000],
    [24, 97_000],
    [23, 91_600],
  ]);
});

test("un niveau sans temps mesuré interrompt le cumul, sans estimation", () => {
  const rows = [row(1, 600), row(2, 900), row(3, null), row(4, 1200)];
  const levels = fillLevelTimes(buildLevelTimes(rows, playtime(5, 10_000, 9000), 5), 5);

  // Niveaux 4 et 5 depuis le total, niveaux 1 et 2 par addition depuis le début ; rien pour le 3.
  assert.deepEqual([...cumulativePlayedSeconds(levels, 10_000)].sort(([a], [b]) => a - b), [
    [1, 600],
    [2, 1500],
    [4, 9000],
    [5, 10_000],
  ]);
});

test("le cumul se passe du total quand tout est mesuré depuis le niveau 1", () => {
  const levels = fillLevelTimes(buildLevelTimes([row(1, 600), row(2, 900)], null, 3), 3);

  assert.deepEqual([...cumulativePlayedSeconds(levels, null)], [
    [1, 600],
    [2, 1500],
  ]);
  // Ni total ni niveau 1 mesuré : aucun point de départ.
  assert.equal(cumulativePlayedSeconds(fillLevelTimes(buildLevelTimes([row(3, 600)], null, 4), 4), null).size, 0);
  assert.equal(cumulativePlayedSeconds([], 100).size, 0);
});

test("un total incohérent ne donne jamais de cumul négatif", () => {
  const levels = fillLevelTimes(buildLevelTimes([row(23, 3600), row(24, 5400)], playtime(25, 3000, 2000), 25), 25);

  assert.deepEqual([...cumulativePlayedSeconds(levels, 3000)], [
    [25, 3000],
    [24, 2000],
  ]);
});
