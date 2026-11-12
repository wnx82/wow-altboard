import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InventoryData } from "./inventory";
import {
  DEFAULT_STATE,
  groupByCharacter,
  groupByGuild,
  groupByItem,
  readInventoryState,
  selectHoldings,
  writeInventoryState,
  type InventoryState,
} from "./inventory-view";

const NOW = new Date("2026-11-12T18:00:00Z");
const read = (search: string) => readInventoryState(new URLSearchParams(search));
const state = (patch: Partial<InventoryState>): InventoryState => ({ ...DEFAULT_STATE, ...patch });
const seen = { bags: null, bank: null, mail: null, auctions: null };

const DATA: InventoryData = {
  characters: [
    { id: 1, name: "Élodie", realm: "PvE", class: "MAGE", level: 60, account: { id: 10, label: "Principal", featured: true }, seen },
    { id: 2, name: "Zoé", realm: "PvE", class: "ROGUE", level: 12, account: { id: 20, label: "Second", featured: false }, seen },
  ],
  entries: [
    { characterId: 1, location: "bags", itemKey: "2589", quantity: 20, expiresAt: null },
    { characterId: 1, location: "mail", itemKey: "2589", quantity: 5, expiresAt: "2026-11-20T00:00:00Z" },
    { characterId: 1, location: "mail", itemKey: "15210:1017", quantity: 1, expiresAt: "2026-11-01T00:00:00Z" },
    { characterId: 2, location: "bank", itemKey: "2589", quantity: 7, expiresAt: null },
    { characterId: 2, location: "auctions", itemKey: "20576", quantity: 1, expiresAt: "2026-11-13T00:00:00Z" },
  ],
  guilds: [
    {
      id: 5,
      name: "Ordre",
      realm: "PvE",
      accountId: 10,
      accountLabel: "Principal",
      moneyCopper: 100,
      seenAt: "2026-11-12T10:00:00Z",
      tabs: [
        { index: 1, name: "Composants", items: [{ itemKey: "2589", quantity: 40 }] },
        { index: 2, name: null, items: [{ itemKey: "20576", quantity: 2 }] },
      ],
    },
  ],
  items: {
    "2589": { name: "Étoffe de lin", quality: 1, icon: null },
    "15210:1017": { name: "Épée large de l'ours", quality: 2, icon: null },
    "20576": { name: "Peau noire", quality: 3, icon: null },
  },
};

const select = (patch: Partial<InventoryState> = {}) => selectHoldings(DATA, state(patch), NOW);

describe("page Inventaires : état dans l'adresse", () => {
  test("une adresse sans paramètre donne l'état par défaut, et inversement", () => {
    assert.deepEqual(read(""), DEFAULT_STATE);
    assert.equal(writeInventoryState(DEFAULT_STATE), "");
  });

  test("aller-retour d'un état complet, les autres paramètres gardés", () => {
    const full = state({ query: "étoffe", account: "10", character: "1", places: ["bags", "guild"], minQuality: "2", expired: true, view: "characters", sort: "name" });
    const search = writeInventoryState(full, "?autre=1");
    assert.match(search, /autre=1/);
    assert.deepEqual(read(search), full);
  });

  test("les valeurs illisibles gardent leur valeur par défaut", () => {
    assert.deepEqual(read("compte=abc&perso=-1&lieux=nulle-part&qualite=9&vue=x&tri=y&echus=oui"), DEFAULT_STATE);
  });
});

describe("page Inventaires : filtres et regroupements", () => {
  test("par défaut : tout sauf les courriers échus, banques de guilde comprises", () => {
    const holdings = select();
    assert.equal(holdings.length, 6);
    assert.equal(holdings.some((holding) => holding.itemKey === "15210:1017"), false);
    assert.equal(select({ expired: true }).length, 7);
  });

  test("le total d'un objet additionne personnages, endroits et banques de guilde", () => {
    const [linen] = groupByItem(select(), DATA.items, "total");
    assert.equal(linen.itemKey, "2589");
    assert.equal(linen.total, 20 + 5 + 7 + 40);
    assert.deepEqual(
      linen.holdings.map((holding) => holding.quantity),
      [40, 20, 7, 5],
    );
  });

  test("recherche sans accent, par identifiant (variantes comprises), par qualité minimale", () => {
    assert.deepEqual(new Set(select({ query: "etoffe" }).map((h) => h.itemKey)), new Set(["2589"]));
    assert.deepEqual(select({ query: "15210", expired: true }).map((h) => h.itemKey), ["15210:1017"]);
    assert.deepEqual(new Set(select({ minQuality: "3" }).map((h) => h.itemKey)), new Set(["20576"]));
  });

  test("compte, personnage et endroits", () => {
    // Le compte garde sa banque de guilde ; un personnage choisi l'écarte.
    assert.deepEqual(
      select({ account: "10" }).map((h) => (h.kind === "guild" ? `guilde-${h.tab}` : `${h.characterId}-${h.location}`)),
      ["1-bags", "1-mail", "guilde-1", "guilde-2"],
    );
    assert.equal(select({ character: "1" }).every((h) => h.kind === "character" && h.characterId === 1), true);
    assert.deepEqual(select({ places: ["auctions"] }).map((h) => h.itemKey), ["20576"]);
  });

  test("tri par nom et par qualité", () => {
    const names = (sort: InventoryState["sort"]) => groupByItem(select({ expired: true }), DATA.items, sort).map((row) => row.name);
    assert.deepEqual(names("name"), ["Épée large de l'ours", "Étoffe de lin", "Peau noire"]);
    assert.deepEqual(names("quality"), ["Peau noire", "Épée large de l'ours", "Étoffe de lin"]);
  });

  test("par personnage et par guilde, rangés par endroit puis par onglet", () => {
    const characters = groupByCharacter(select());
    assert.deepEqual(
      characters.get(1)?.map((group) => group.place),
      ["bags", "mail"],
    );
    assert.deepEqual(
      characters.get(2)?.map((group) => group.place),
      ["bank", "auctions"],
    );
    assert.deepEqual(
      groupByGuild(select()).get(5)?.map((group) => group.tab),
      [1, 2],
    );
  });
});
