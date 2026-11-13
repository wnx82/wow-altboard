import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { GearSpec } from "@/lib/wow/gear";
import {
  ARMOR_TIER_COST,
  DEFAULT_PLANNER_STATE,
  gearScore,
  type GearPlannerData,
  planGear,
  type PlannerState,
  plannerTarget,
  preferredArmor,
  readPlannerState,
  writePlannerState,
} from "./gear-planner";

const NOW = new Date("2026-11-13T12:00:00Z");
const seen = { bags: null, bank: null, mail: null, auctions: null };
const account = { id: 10, label: "Principal", featured: true };

const armor = (subclass: number, inventoryType: number, itemLevel: number, requiredLevel: number, bonding = 2): GearSpec => ({
  itemClass: 4,
  subclass,
  inventoryType,
  itemLevel,
  requiredLevel,
  allowableClass: null,
  bonding,
});
const weapon = (subclass: number, inventoryType: number, itemLevel: number, requiredLevel: number): GearSpec => ({ ...armor(0, 0, 0, 0), itemClass: 2, subclass, inventoryType, itemLevel, requiredLevel });
const item = (name: string, gear: GearSpec, quality = 2) => ({ name, quality, icon: null, gear });

// Élodie, mage 60 ; Zoé, voleuse 12 ; Brann, guerrier 45 qui porte un plastron, un anneau et une arme.
const DATA: GearPlannerData = {
  characters: [
    { id: 1, name: "Élodie", realm: "PvE", class: "MAGE", level: 60, account, seen },
    { id: 2, name: "Zoé", realm: "PvE", class: "ROGUE", level: 12, account, seen },
    { id: 3, name: "Brann", realm: "PvE", class: "WARRIOR", level: 45, account, seen },
  ],
  entries: [
    { characterId: 2, location: "bags", itemKey: "100", quantity: 1, expiresAt: null },
    { characterId: 1, location: "bank", itemKey: "102", quantity: 1, expiresAt: null },
    { characterId: 2, location: "bank", itemKey: "103", quantity: 1, expiresAt: null },
    { characterId: 1, location: "bags", itemKey: "105", quantity: 1, expiresAt: null },
    { characterId: 2, location: "bags", itemKey: "106", quantity: 1, expiresAt: null },
    { characterId: 3, location: "bags", itemKey: "107", quantity: 1, expiresAt: null },
    { characterId: 1, location: "mail", itemKey: "110", quantity: 1, expiresAt: "2026-11-01T00:00:00Z" },
    { characterId: 2, location: "auctions", itemKey: "112", quantity: 1, expiresAt: "2026-11-14T00:00:00Z" },
  ],
  guilds: [
    {
      id: 5,
      name: "Ordre",
      realm: "PvE",
      accountId: 10,
      accountLabel: "Principal",
      moneyCopper: 0,
      seenAt: "2026-11-12T10:00:00Z",
      tabs: [
        {
          index: 1,
          name: null,
          items: [
            { itemKey: "101", quantity: 1 },
            { itemKey: "104", quantity: 2 },
            { itemKey: "108", quantity: 1 },
            { itemKey: "109", quantity: 1 },
            { itemKey: "111", quantity: 1 },
            { itemKey: "113", quantity: 1 },
            { itemKey: "114", quantity: 1 },
            { itemKey: "115", quantity: 1 },
            { itemKey: "116", quantity: 1 },
          ],
        },
      ],
    },
  ],
  items: {
    "100": item("Robe de tissu", armor(1, 20, 30, 25)),
    "101": item("Plastron de mailles", armor(3, 5, 40, 35)),
    "102": item("Plastron de plaques", armor(4, 5, 38, 40), 3),
    "103": item("Anneau A", armor(0, 11, 20, 15)),
    "104": item("Anneau B", armor(0, 11, 25, 20)),
    "105": item("Anneau C", armor(0, 11, 10, 5)),
    "106": item("Bijou lié", armor(0, 12, 30, 10, 1)),
    "107": item("Épée à deux mains", weapon(8, 17, 35, 30)),
    "108": item("Dague de main gauche", weapon(15, 22, 20, 15)),
    "109": item("Bouclier", armor(6, 14, 25, 20)),
    "110": item("Baguette", weapon(19, 26, 22, 18)),
    "111": item("Libram", armor(7, 28, 20, 15)),
    "112": item("Casque de cuir", armor(2, 1, 50, 46)),
    "113": item("Jambières de cuir", armor(2, 7, 45, 40)),
    "114": item("Jambières de plaques", armor(4, 7, 33, 40)),
    "115": item("Jambières de mailles", armor(3, 7, 44, 40)),
    "116": item("Épée courte", weapon(7, 13, 30, 25)),
  },
  equipment: {
    "3": [
      { slot: 5, itemId: 900, name: "Vieux plastron", quality: 1, itemLevel: 30, icon: null, spec: null },
      { slot: 7, itemId: 903, name: "Vieilles jambières", quality: 2, itemLevel: 36, icon: null, spec: { itemClass: 4, subclass: 4 } },
      { slot: 11, itemId: 901, name: "Vieil anneau", quality: 1, itemLevel: 18, icon: null, spec: null },
      { slot: 16, itemId: 902, name: "Grande hache", quality: 3, itemLevel: 40, icon: null, spec: null },
    ],
  },
};

const plan = (patch: Partial<PlannerState>) => planGear(DATA, { ...DEFAULT_PLANNER_STATE, ...patch }, NOW)!;
const slot = (patch: Partial<PlannerState>, id: string) => {
  const found = plan(patch).slots.find((candidate) => candidate.slot.id === id)!;
  return { label: found.label, picks: found.picks.map((pick) => pick.itemKey), others: found.others.map((other) => other.itemKey), deltas: found.picks.map((pick) => pick.delta) };
};

describe("page Équipement : état dans l'adresse et cible", () => {
  test("aller-retour, valeurs par défaut omises, valeurs illisibles ignorées", () => {
    assert.deepEqual(readPlannerState(new URLSearchParams("")), DEFAULT_PLANNER_STATE);
    assert.equal(writePlannerState(DEFAULT_PLANNER_STATE), "");
    const full: PlannerState = { target: "WARRIOR", level: "45", places: ["bags", "bank"], ownArmor: true, upgrades: true };
    const search = writePlannerState(full, "?autre=1");
    assert.equal(search, "?autre=1&pour=guerrier&niveau=45&lieux=sacs%2Cbanque&armure=1&ameliorations=1");
    assert.deepEqual(readPlannerState(new URLSearchParams(search)), full);
    assert.deepEqual(readPlannerState(new URLSearchParams("pour=paysan&niveau=61&lieux=nulle-part")), DEFAULT_PLANNER_STATE);
    assert.equal(readPlannerState(new URLSearchParams("niveau=0")).level, "");
    assert.equal(readPlannerState(new URLSearchParams("pour=3")).target, "3");
  });

  test("une classe vise le niveau 60 ; un personnage, son niveau ; le niveau choisi l'emporte", () => {
    assert.deepEqual(plannerTarget({ ...DEFAULT_PLANNER_STATE, target: "PRIEST" }, DATA.characters), { classToken: "PRIEST", level: 60, character: null });
    const brann = plannerTarget({ ...DEFAULT_PLANNER_STATE, target: "3" }, DATA.characters);
    assert.deepEqual([brann?.classToken, brann?.level, brann?.character?.name], ["WARRIOR", 45, "Brann"]);
    assert.equal(plannerTarget({ ...DEFAULT_PLANNER_STATE, target: "3", level: "20" }, DATA.characters)?.level, 20);
    assert.equal(plannerTarget({ ...DEFAULT_PLANNER_STATE, target: "99" }, DATA.characters), null);
    assert.equal(plannerTarget(DEFAULT_PLANNER_STATE, DATA.characters), null);
  });

  test("meilleur type d'armure : mailles et plaques au niveau 40", () => {
    assert.equal(preferredArmor("WARRIOR", 39), 3);
    assert.equal(preferredArmor("WARRIOR", 40), 4);
    assert.equal(preferredArmor("HUNTER", 20), 2);
    assert.equal(preferredArmor("SHAMAN", 40), 3);
    assert.equal(preferredArmor("MAGE", 60), 1);
  });
});

describe("page Équipement : meilleurs objets par emplacement", () => {
  test("niveau d'objet, moins dix par rang d'armure plus légère ; ce que la classe porte à ce niveau", () => {
    assert.equal(ARMOR_TIER_COST, 10);
    assert.equal(gearScore(armor(1, 5, 30, 1), 4), 0);
    assert.equal(gearScore(armor(4, 5, 30, 1), 4), 30);
    assert.equal(gearScore(armor(0, 11, 30, 1), 4), 30, "un anneau n'a pas de type d'armure");
    assert.equal(gearScore(armor(1, 5, 30, 1), 1), 30);
    // Plaques 38, mailles 40 − 10, tissu 30 − 30.
    assert.deepEqual(slot({ target: "WARRIOR", level: "45" }, "torse"), { label: "Torse", picks: ["102"], others: ["101", "100"], deltas: [null] });
    // Mailles 44 − 10 devant plaques 33, cuir 45 − 20 derrière.
    assert.deepEqual(slot({ target: "WARRIOR", level: "45" }, "jambes").picks, ["115"]);
    assert.deepEqual(slot({ target: "WARRIOR", level: "45" }, "jambes").others, ["114", "113"]);
    // Niveau 35 : pas encore de plaques.
    assert.deepEqual(slot({ target: "WARRIOR", level: "35" }, "torse").picks, ["101"]);
    assert.deepEqual(slot({ target: "WARRIOR", level: "35" }, "torse").others, ["100"]);
    // Son type d'armure seulement : les plaques.
    assert.deepEqual(slot({ target: "WARRIOR", level: "45", ownArmor: true }, "torse"), { label: "Torse", picks: ["102"], others: [], deltas: [null] });
    assert.deepEqual(slot({ target: "WARRIOR", level: "45", ownArmor: true }, "jambes").picks, ["114"]);
    // Un mage ne porte que le tissu.
    assert.deepEqual(slot({ target: "MAGE" }, "torse").picks, ["100"]);
  });

  test("deux anneaux, deux bijoux ; un objet lié quand ramassé reste à son détenteur", () => {
    // Anneau B détenu en deux exemplaires : il occupe les deux doigts.
    assert.deepEqual(slot({ target: "MAGE" }, "doigts"), { label: "Doigts", picks: ["104", "104"], others: ["103", "105"], deltas: [null, null] });
    assert.deepEqual(slot({ target: "ROGUE" }, "bijoux").picks, ["106"], "chez une voleuse");
    assert.deepEqual(slot({ target: "MAGE" }, "bijoux").picks, [], "lié à une voleuse");
    assert.deepEqual(slot({ target: "2", level: "30" }, "bijoux").picks, ["106"], "Zoé elle-même");
    assert.deepEqual(slot({ target: "1" }, "bijoux").picks, [], "pas Élodie");
    assert.equal(plan({ target: "ROGUE" }).slots.find((candidate) => candidate.slot.id === "bijoux")?.picks[0]?.bound, true);
  });

  test("armes : deux mains, main gauche selon l'ambidextrie et le bouclier, relique pour le paladin", () => {
    assert.deepEqual(slot({ target: "WARRIOR", level: "45" }, "arme"), { label: "Arme principale", picks: ["107"], others: ["116"], deltas: [null] });
    // L'épée à une main va en main gauche, avec l'ambidextrie.
    assert.deepEqual(slot({ target: "WARRIOR", level: "45" }, "main-gauche"), { label: "Main gauche", picks: ["116"], others: ["109", "108"], deltas: [null] });
    assert.deepEqual(slot({ target: "WARRIOR", level: "19" }, "main-gauche").others, [], "ambidextrie au niveau 20");
    // Un seul exemplaire : en main droite chez la voleuse, il n'est plus proposé en main gauche.
    assert.deepEqual(slot({ target: "ROGUE", level: "30" }, "arme").picks, ["116"]);
    assert.deepEqual(slot({ target: "ROGUE", level: "30" }, "main-gauche"), { label: "Main gauche", picks: ["108"], others: [], deltas: [null] });
    assert.deepEqual(slot({ target: "MAGE" }, "main-gauche").picks, []);
    assert.deepEqual(slot({ target: "PALADIN" }, "distance"), { label: "Relique", picks: ["111"], others: [], deltas: [null] });
  });

  test("courriers échus et ventes en cours écartés, sauf enchères cochées", () => {
    assert.deepEqual(slot({ target: "MAGE" }, "distance").picks, [], "baguette au courrier échu");
    assert.deepEqual(slot({ target: "ROGUE", level: "50" }, "tete").picks, []);
    assert.deepEqual(slot({ target: "ROGUE", level: "50", places: ["bags", "bank", "mail", "guild", "auctions"] }, "tete").picks, ["112"]);
  });

  test("pour un personnage : écart de score avec ce qu'il porte, améliorations seulement", () => {
    assert.deepEqual(slot({ target: "3" }, "torse").deltas, [8]);
    // Anneaux portés : 18 et un emplacement vide ; le meilleur remplace le vide.
    assert.deepEqual(slot({ target: "3" }, "doigts"), { label: "Doigts", picks: ["104", "104"], others: ["103", "105"], deltas: [25, 7] });
    assert.deepEqual(slot({ target: "3" }, "arme").deltas, [-5]);
    // Jambières de plaques 36 portées : les mailles 44 valent 34, pas une amélioration.
    assert.deepEqual(slot({ target: "3" }, "jambes").deltas, [-2]);
    assert.deepEqual(slot({ target: "3", upgrades: true }, "jambes").picks, []);
    assert.deepEqual(slot({ target: "3", upgrades: true }, "arme").picks, []);
    assert.deepEqual(slot({ target: "3", upgrades: true }, "doigts").picks, ["104", "104"]);
    // Plastron de plaques +8, anneaux +25 et +7, épée à la place d'une main gauche vide ; le bijou
    // lié à Zoé ne compte pas.
    assert.equal(plan({ target: "3" }).upgrades, 4);
  });

  test("améliorations seulement : rien n'est écarté face à un objet porté au niveau inconnu", () => {
    const data: GearPlannerData = {
      ...DATA,
      equipment: { "3": [{ slot: 1, itemId: 904, name: "Casque mystère", quality: 2, itemLevel: null, icon: null, spec: null }] },
    };
    const found = planGear(data, { ...DEFAULT_PLANNER_STATE, target: "3", level: "50", upgrades: true, places: ["bags", "bank", "mail", "guild", "auctions"] }, NOW)!;
    const head = found.slots.find((candidate) => candidate.slot.id === "tete")!;
    assert.deepEqual(head.picks.map((pick) => [pick.itemKey, pick.delta]), [["112", null]]);
  });
});
