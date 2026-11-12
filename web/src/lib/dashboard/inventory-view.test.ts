import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InventoryData } from "./inventory";
import {
  DEFAULT_STATE,
  expiryFlag,
  groupByCharacter,
  groupByGuild,
  groupByItem,
  holdingsValue,
  readInventoryState,
  rowFlag,
  selectHoldings,
  slotCount,
  sortHoldings,
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
  prices: { "2589": 150, "20576": 12_000 },
  market: { id: 1, label: "PvE · WoW Forever" },
};

const select = (patch: Partial<InventoryState> = {}) => selectHoldings(DATA, state(patch), NOW);

describe("page Inventaires : état dans l'adresse", () => {
  test("une adresse sans paramètre donne l'état par défaut, et inversement", () => {
    assert.deepEqual(read(""), DEFAULT_STATE);
    assert.equal(writeInventoryState(DEFAULT_STATE), "");
  });

  test("aller-retour d'un état complet, les autres paramètres gardés", () => {
    const full = state({
      query: "étoffe",
      account: "10",
      character: "1",
      places: ["bags", "guild"],
      minQuality: "2",
      expired: true,
      soon: true,
      view: "characters",
      sort: "value",
    });
    const search = writeInventoryState(full, "?autre=1");
    assert.match(search, /autre=1/);
    assert.deepEqual(read(search), full);
  });

  test("les valeurs illisibles gardent leur valeur par défaut", () => {
    assert.deepEqual(read("compte=abc&perso=-1&lieux=nulle-part&qualite=9&vue=x&tri=y&echus=oui&bientot=2"), DEFAULT_STATE);
    assert.equal(writeInventoryState(state({ soon: true, sort: "value" })), "?bientot=1&tri=valeur");
  });

  test("un personnage choisi s'affiche sac par sac, sauf présentation demandée", () => {
    assert.equal(read("perso=17").view, "characters");
    assert.equal(read("perso=17&vue=objets").view, "items");
    assert.equal(writeInventoryState(state({ character: "17", view: "characters" })), "?perso=17");
    assert.equal(writeInventoryState(state({ character: "17", view: "items" })), "?perso=17&vue=objets");
    assert.equal(writeInventoryState(state({ view: "characters" })), "?vue=personnages");
  });
});

describe("page Inventaires : cases", () => {
  test("quantité au coin d'une case : entière jusqu'à 9 999, puis en milliers arrondis vers le bas", () => {
    assert.deepEqual(
      [1, 20, 9999, 10_000, 12_345, 99_999, 100_000, 245_678].map(slotCount),
      ["1", "20", "9999", "10k", "12,3k", "99,9k", "100k", "245k"],
    );
  });

  test("les cases d'un endroit suivent le tri de la grille", () => {
    const bags = select({ character: "1", expired: true });
    const order = (sort: InventoryState["sort"]) => sortHoldings(bags, DATA.items, sort).map((holding) => `${holding.itemKey}×${holding.quantity}`);
    assert.deepEqual(order("total"), ["2589×20", "2589×5", "15210:1017×1"]);
    assert.deepEqual(
      sortHoldings(bags, DATA.items, "value", DATA.prices).map((holding) => `${holding.itemKey}×${holding.quantity}`),
      ["2589×20", "2589×5", "15210:1017×1"],
    );
    assert.deepEqual(order("name"), ["15210:1017×1", "2589×20", "2589×5"]);
    assert.deepEqual(order("quality"), ["15210:1017×1", "2589×20", "2589×5"]);
  });
});

describe("page Inventaires : échéances", () => {
  test("au coin d'une case : échu, puis le temps restant dans les trois derniers jours", () => {
    const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();
    assert.deepEqual(expiryFlag(null, NOW), null);
    assert.deepEqual(expiryFlag(at(-1), NOW), { text: "échu", tone: "expired" });
    assert.deepEqual(expiryFlag(at(0.5), NOW), { text: "< 1 h", tone: "soon" });
    assert.deepEqual(expiryFlag(at(5.9), NOW), { text: "5 h", tone: "soon" });
    assert.deepEqual(expiryFlag(at(47), NOW), { text: "47 h", tone: "soon" });
    assert.deepEqual(expiryFlag(at(60), NOW), { text: "2 j", tone: "soon" });
    assert.deepEqual(expiryFlag(at(72), NOW), { text: "3 j", tone: "soon" });
    assert.deepEqual(expiryFlag(at(73), NOW), null);
  });

  test("un objet n'est échu que si tous ses exemplaires datés le sont ; sinon l'échéance la plus proche", () => {
    const rows = groupByItem(select({ expired: true }), DATA.items, "total");
    const flagOf = (key: string) => rowFlag(rows.find((row) => row.itemKey === key)!.holdings, NOW);
    assert.deepEqual(flagOf("15210:1017"), { text: "échu", tone: "expired" });
    assert.deepEqual(flagOf("20576"), { text: "6 h", tone: "soon" });
    assert.equal(flagOf("2589"), null);
  });

  test("filtre « Bientôt échus » : les échéances proches, les échues avec « Échus »", () => {
    assert.deepEqual(select({ soon: true }).map((h) => h.itemKey), ["20576"]);
    assert.deepEqual(select({ soon: true, expired: true }).map((h) => h.itemKey), ["15210:1017", "20576"]);
  });
});

describe("page Inventaires : valeur", () => {
  test("valeur de marché d'un objet et de lignes, exemplaires sans prix comptés à part", () => {
    const rows = groupByItem(select({ expired: true }), DATA.items, "value", DATA.prices);
    assert.deepEqual(
      rows.map((row) => [row.itemKey, row.unit, row.value]),
      [
        ["20576", 12_000, 36_000],
        ["2589", 150, 72 * 150],
        ["15210:1017", null, null],
      ],
    );
    // Le courrier échu (15210:1017) s'affiche avec « Échus », mais ne compte plus dans la valeur.
    assert.deepEqual(holdingsValue(select({ expired: true }), DATA.prices, NOW), { value: 36_000 + 72 * 150, unpriced: 0 });
    assert.deepEqual(holdingsValue(select(), DATA.prices, NOW), { value: 36_000 + 72 * 150, unpriced: 0 });
    assert.deepEqual(holdingsValue([{ itemKey: "15210:1017", quantity: 1, expiresAt: "2026-11-13T00:00:00Z" }], DATA.prices, NOW), { value: 0, unpriced: 1 });
    assert.deepEqual(holdingsValue([], DATA.prices, NOW), { value: 0, unpriced: 0 });
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

// Une épée à une main (au courrier, échue), un gilet de cuir chez Zoé, des jambières de plaques
// réservées aux guerriers chez Élodie.
const GEAR: InventoryData = {
  ...DATA,
  entries: [
    ...DATA.entries,
    { characterId: 2, location: "bags", itemKey: "2316", quantity: 1, expiresAt: null },
    { characterId: 1, location: "bank", itemKey: "16866", quantity: 1, expiresAt: null },
  ],
  items: {
    ...DATA.items,
    "15210:1017": { ...DATA.items["15210:1017"], gear: { itemClass: 2, subclass: 7, inventoryType: 13, itemLevel: 16, requiredLevel: 11, allowableClass: null } },
    "2316": { name: "Gilet en cuir", quality: 1, icon: null, gear: { itemClass: 4, subclass: 2, inventoryType: 5, itemLevel: 16, requiredLevel: 11, allowableClass: null } },
    "16866": { name: "Jambières de puissance", quality: 4, icon: null, gear: { itemClass: 4, subclass: 4, inventoryType: 7, itemLevel: 66, requiredLevel: 60, allowableClass: 1 } },
  },
};
const gear = (patch: Partial<InventoryState>) => [...new Set(selectHoldings(GEAR, state({ expired: true, ...patch }), NOW).map((holding) => holding.itemKey))].sort();

describe("page Inventaires : filtres d'équipement", () => {
  test("type d'armure ou d'arme et emplacement ; le reste des objets disparaît", () => {
    assert.deepEqual(gear({ gearType: "cuir" }), ["2316"]);
    assert.deepEqual(gear({ gearType: "armure" }), ["16866", "2316"]);
    assert.deepEqual(gear({ gearType: "arme" }), ["15210:1017"]);
    assert.deepEqual(gear({ gearType: "epee-2m" }), []);
    assert.deepEqual(gear({ gearSlot: "jambes" }), ["16866"]);
    assert.deepEqual(gear({}), ["15210:1017", "16866", "20576", "2316", "2589"]);
  });

  test("tranche de niveau requis, bornes comprises", () => {
    assert.deepEqual(gear({ minLevel: "10", maxLevel: "20" }), ["15210:1017", "2316"]);
    assert.deepEqual(gear({ minLevel: "60" }), ["16866"]);
    assert.deepEqual(gear({ maxLevel: "10" }), []);
  });

  test("pour une classe : ce qu'elle peut porter ; pour un personnage : à son niveau", () => {
    assert.deepEqual(gear({ wearer: "ROGUE" }), ["15210:1017", "2316"]);
    assert.deepEqual(gear({ wearer: "MAGE" }), ["15210:1017"]);
    assert.deepEqual(gear({ wearer: "WARRIOR" }), ["15210:1017", "16866", "2316"]);
    // Zoé, voleuse de niveau 12 ; Élodie, mage de niveau 60.
    assert.deepEqual(gear({ wearer: "2" }), ["15210:1017", "2316"]);
    assert.deepEqual(gear({ wearer: "1" }), ["15210:1017"]);
    assert.deepEqual(gear({ wearer: "99" }), [], "personnage inconnu");
  });

  test("tri par niveau requis, du plus haut au plus bas, l'équipement d'abord", () => {
    const rows = groupByItem(selectHoldings(GEAR, state({ expired: true }), NOW), GEAR.items, "level");
    assert.deepEqual(
      rows.map((row) => row.itemKey),
      ["16866", "15210:1017", "2316", "2589", "20576"],
    );
  });

  test("dans l'adresse, en français ; les valeurs illisibles sont ignorées", () => {
    const full = state({ gearType: "cuir", gearSlot: "torse", minLevel: "10", maxLevel: "20", wearer: "HUNTER", sort: "level" });
    const search = writeInventoryState(full);
    assert.equal(search, "?type=cuir&emplacement=torse&nmin=10&nmax=20&pour=chasseur&tri=niveau");
    assert.deepEqual(read(search), full);
    assert.equal(read("?pour=12").wearer, "12");
    assert.deepEqual(read("?type=sabre&emplacement=nez&nmin=0&nmax=abc&pour=paysan"), DEFAULT_STATE);
  });
});
