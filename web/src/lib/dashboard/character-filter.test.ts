import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_FILTERS } from "./browser-state";
import { filterCharacters, goalState, sortCharacters } from "./character-filter";
import { fold } from "./inventory-view";
import type { CharacterListItem } from "./queries";

function character(id: number, name: string, extra: Partial<CharacterListItem> = {}): CharacterListItem {
  return {
    id,
    name,
    realm: "Valtharion",
    class: "MAGE",
    race: "Gnome",
    faction: "Alliance",
    level: 10,
    xp: null,
    xpMax: null,
    guild: null,
    zone: null,
    moneyCopper: null,
    itemLevel: null,
    hidden: false,
    account: { id: 1, label: "Compte 1", featured: false },
    machines: [{ id: 1, label: "MSI" }],
    professions: [],
    goals: { done: 0, total: 0 },
    tags: [],
    note: null,
    sourceLastSeenAt: "2026-11-20T10:00:00Z",
    lastSyncAt: "2026-11-20T10:00:00Z",
    ...extra,
  };
}

const ALL = { query: "", filters: NO_FILTERS, favoritesOnly: false };

test("recherche sans accents ni casse, sur le nom, la classe et les métiers", () => {
  const list = [
    character(1, "Élodie"),
    character(2, "Brak", { class: "WARRIOR", professions: [{ skillLine: 164, name: "Forge", rank: 1, maxRank: 75, isPrimary: true }] }),
  ];
  assert.equal(fold("Élodie"), "elodie");
  assert.deepEqual(filterCharacters(list, { ...ALL, query: "elod" }).map((c) => c.id), [1]);
  assert.deepEqual(filterCharacters(list, { ...ALL, query: "guerrier" }).map((c) => c.id), [2]);
  assert.deepEqual(filterCharacters(list, { ...ALL, query: "forge" }).map((c) => c.id), [2]);
  assert.equal(filterCharacters(list, ALL).length, 2);
});

test("filtres : compte, niveaux, objectifs, favoris", () => {
  const list = [
    character(1, "A", { level: 5, goals: { done: 1, total: 2 } }),
    character(2, "B", { level: 30, account: { id: 2, label: "Compte 2", featured: true }, goals: { done: 2, total: 2 } }),
    character(3, "C", { level: null }),
  ];
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, account: "2" } }).map((c) => c.id), [2]);
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, minLevel: "10" } }).map((c) => c.id), [2]);
  // Un niveau inconnu ne passe aucune borne.
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, maxLevel: "40" } }).map((c) => c.id), [1, 2]);
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, goals: "open" } }).map((c) => c.id), [1]);
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, goals: "none" } }).map((c) => c.id), [3]);
  assert.deepEqual(filterCharacters(list, { ...ALL, favoritesOnly: true }).map((c) => c.id), [2]);
  assert.equal(goalState({ done: 2, total: 2 }), "done");
});

test("étiquette : filtre exact ; la recherche lit aussi les étiquettes et la note", () => {
  const list = [
    character(1, "A", { tags: ["principal"], note: "Farm du cuir à Tanaris" }),
    character(2, "B", { tags: ["banque", "reroll"] }),
    character(3, "C"),
  ];
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, tag: "banque" } }).map((c) => c.id), [2]);
  assert.deepEqual(filterCharacters(list, { ...ALL, filters: { ...NO_FILTERS, tag: "ban" } }).map((c) => c.id), []);
  assert.deepEqual(filterCharacters(list, { ...ALL, query: "reroll" }).map((c) => c.id), [2]);
  assert.deepEqual(filterCharacters(list, { ...ALL, query: "tanaris" }).map((c) => c.id), [1]);
});

test("tri : valeurs absentes à la fin dans les deux sens, nom à égalité", () => {
  const list = [character(1, "Zed", { level: 20 }), character(2, "Abe", { level: null }), character(3, "Bob", { level: 20 }), character(4, "Cid", { level: 40 })];
  assert.deepEqual(sortCharacters(list, { key: "level", descending: true }).map((c) => c.name), ["Cid", "Bob", "Zed", "Abe"]);
  assert.deepEqual(sortCharacters(list, { key: "level", descending: false }).map((c) => c.name), ["Bob", "Zed", "Cid", "Abe"]);
  assert.deepEqual(sortCharacters(list, { key: "name", descending: false }).map((c) => c.name), ["Abe", "Bob", "Cid", "Zed"]);
  // La liste d'origine n'est pas modifiée.
  assert.deepEqual(list.map((c) => c.id), [1, 2, 3, 4]);
});
