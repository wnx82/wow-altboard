import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildWatchList, EXPECTED_SLOTS, silentDays, watchCount, type WatchCharacter, type WatchFacts } from "./watch";

const NOW = new Date("2026-11-09T12:00:00Z");
const DAY = 24 * 3600 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const character = (id: number, extra: Partial<WatchCharacter> = {}): WatchCharacter => ({
  id,
  name: `Perso${id}`,
  class: "MAGE",
  level: 20,
  hidden: false,
  professions: [],
  sourceLastSeenAt: ago(1).toISOString(),
  ...extra,
});
const facts = (extra: Partial<WatchFacts> = {}): WatchFacts => ({
  bagSlotsUsed: 10,
  bagSlotsTotal: 40,
  bankAt: ago(2),
  equippedSlots: [...EXPECTED_SLOTS],
  mail: null,
  ...extra,
});

describe("à surveiller", () => {
  test("rien à signaler pour un personnage en ordre", () => {
    const list = buildWatchList([character(1)], new Map([[1, facts()]]), [{ id: 1, label: "MSI", lastSeenAt: ago(0) }], NOW);
    assert.equal(watchCount(list), 0);
  });

  test("sacs presque pleins, banque jamais relevée, personnage ancien, équipement incomplet", () => {
    const list = buildWatchList(
      [character(1, { sourceLastSeenAt: ago(20).toISOString() }), character(2)],
      new Map([
        [1, facts({ bagSlotsUsed: 40, bankAt: null })],
        [2, facts({ bagSlotsUsed: 38, equippedSlots: [1, 2, 3, 4, 19] })],
      ]),
      [],
      NOW,
    );
    assert.deepEqual(
      list.bags.map((entry) => [entry.character.id, entry.detail]),
      [
        [1, "pleins"],
        [2, "2 places libres"],
      ],
    );
    assert.deepEqual(list.bank.map((entry) => entry.character.id), [1]);
    assert.deepEqual(list.stale.map((entry) => [entry.character.id, entry.detail]), [[1, "20 jours"]]);
    // Chemise et tabard ne comptent pas : 15 attendus, 3 portés.
    assert.deepEqual(list.emptySlots.map((entry) => [entry.character.id, entry.detail]), [[2, "12 vides"]]);
  });

  test("équipement jamais relevé, ou personnage sous le niveau 10 : rien n'est signalé", () => {
    const list = buildWatchList(
      [character(1), character(2, { level: 9 })],
      new Map([
        [1, facts({ equippedSlots: null })],
        [2, facts({ equippedSlots: [] })],
      ]),
      [],
      NOW,
    );
    assert.equal(list.emptySlots.length, 0);
  });

  test("métier au maximum d'un palier inférieur au rang le plus haut", () => {
    const professions = [
      { skillLine: 197, name: "Couture", rank: 75, maxRank: 75, isPrimary: true },
      { skillLine: 186, name: "Minage", rank: 300, maxRank: 300, isPrimary: true },
      { skillLine: 185, name: "Cuisine", rank: 40, maxRank: 75, isPrimary: false },
    ];
    const list = buildWatchList([character(1, { professions })], new Map(), [], NOW);
    assert.deepEqual(list.professions.map((entry) => entry.detail), ["Couture 75/75"]);
  });

  test("courrier qui expire dans les trois jours : objets et temps restant, lien vers l'inventaire filtré", () => {
    const list = buildWatchList(
      [character(1), character(2), character(3)],
      new Map([
        [1, facts({ mail: { items: 3, nextExpiry: new Date(NOW.getTime() + 2.5 * DAY) } })],
        [2, facts({ mail: { items: 1, nextExpiry: new Date(NOW.getTime() + 5 * 3_600_000) } })],
        // Déjà expiré depuis le relevé : plus rien à récupérer.
        [3, facts({ mail: { items: 2, nextExpiry: ago(1) } })],
      ]),
      [],
      NOW,
    );
    assert.deepEqual(
      list.mail.map((entry) => [entry.character.id, entry.detail, entry.href]),
      [
        [1, "3 objets, 2 j", "/inventory?perso=1&bientot=1"],
        [2, "1 objet, 5 h", "/inventory?perso=2&bientot=1"],
      ],
    );
    assert.equal(watchCount(list), 2);
  });

  test("un personnage masqué dans l'addon est ignoré", () => {
    const list = buildWatchList([character(1, { hidden: true })], new Map([[1, facts({ bankAt: null })]]), [], NOW);
    assert.equal(watchCount(list), 0);
  });

  test("PC muet à partir de sept jours, le plus ancien d'abord", () => {
    assert.equal(silentDays(ago(6.9), NOW), null);
    assert.equal(silentDays(ago(7), NOW), 7);
    const list = buildWatchList(
      [],
      new Map(),
      [
        { id: 1, label: "MSI", lastSeenAt: ago(0) },
        { id: 2, label: "PC-GRENIER", lastSeenAt: ago(8) },
        { id: 3, label: "LAPTOP-LENOVO", lastSeenAt: ago(30) },
      ],
      NOW,
    );
    assert.deepEqual(
      list.silentMachines.map(({ machine, days }) => [machine.label, days]),
      [
        ["LAPTOP-LENOVO", 30],
        ["PC-GRENIER", 8],
      ],
    );
  });
});
