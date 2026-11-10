import assert from "node:assert/strict";
import { test } from "node:test";
import { pickChampions } from "./champions";

const character = (name: string, level: number | null, options: { xp?: number; xpMax?: number; itemLevel?: number; hidden?: boolean } = {}) => ({
  name,
  level,
  xp: options.xp ?? null,
  xpMax: options.xpMax ?? null,
  itemLevel: options.itemLevel ?? null,
  hidden: options.hidden ?? false,
});

const names = (characters: { name: string }[]) => characters.map((character) => character.name);

test("les trois personnages les plus hauts, du plus haut au moins haut", () => {
  const champions = pickChampions([character("Brise", 10), character("Aube", 30), character("Cendre", 1), character("Dune", 20)]);

  assert.deepEqual(names(champions), ["Aube", "Dune", "Brise"]);
});

test("à niveau égal : l'expérience gagnée dans le niveau, puis le niveau d'objet, puis le nom", () => {
  const champions = pickChampions(
    [
      character("Écho", 30, { xp: 100, xpMax: 1000, itemLevel: 40 }),
      character("Azur", 30, { xp: 500, xpMax: 1000 }),
      character("Zinc", 30, { xp: 100, xpMax: 1000, itemLevel: 20 }),
      character("Bruine", 30, { xp: 100, xpMax: 1000, itemLevel: 20 }),
    ],
    4,
  );

  assert.deepEqual(names(champions), ["Azur", "Écho", "Bruine", "Zinc"]);
});

test("ni niveau inconnu ni personnage masqué sur le podium", () => {
  const champions = pickChampions([character("Inconnu", null), character("Caché", 60, { hidden: true }), character("Visible", 2)]);

  assert.deepEqual(names(champions), ["Visible"]);
});

test("la liste reçue n'est pas modifiée", () => {
  const characters = [character("B", 1), character("A", 2)];
  pickChampions(characters);

  assert.deepEqual(names(characters), ["B", "A"]);
});
