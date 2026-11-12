import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { allowedClassesLabel, ALL_CLASSIC_CLASSES, ARMOR, canUse, classMask, gearLabel, type GearSpec, matchesGearSlot, matchesGearType, WEAPON } from "./gear";

const armor = (subclass: number, inventoryType: number, patch: Partial<GearSpec> = {}): GearSpec => ({
  itemClass: ARMOR,
  subclass,
  inventoryType,
  itemLevel: 30,
  requiredLevel: 25,
  allowableClass: null,
  ...patch,
});
const weapon = (subclass: number, inventoryType: number, patch: Partial<GearSpec> = {}): GearSpec => ({ ...armor(0, 0), itemClass: WEAPON, subclass, inventoryType, ...patch });

describe("équipement : libellés, types et règles de port de Classic", () => {
  test("un masque qui couvre toutes les classes de Classic, ou -1, ne restreint rien", () => {
    assert.equal(classMask(-1), null);
    assert.equal(classMask(0), null);
    assert.equal(classMask(32767), null);
    assert.equal(classMask(ALL_CLASSIC_CLASSES), null);
    assert.equal(classMask(2), 2);
    // Les bits des classes absentes de Classic (chevalier de la mort : 32) sont ignorés.
    assert.equal(classMask(2 | 32), 2);
  });

  test("libellés comme dans la bulle du jeu", () => {
    assert.equal(gearLabel(armor(2, 5)), "Torse · Cuir");
    assert.equal(gearLabel(weapon(8, 17)), "Deux mains · Épée");
    assert.equal(gearLabel(armor(0, 11)), "Doigt");
    assert.equal(allowedClassesLabel(armor(4, 1, { allowableClass: 1 | 2 })), "Guerrier, Paladin");
    assert.equal(allowedClassesLabel(armor(4, 1)), null);
  });

  test("filtres de type et d'emplacement", () => {
    assert.equal(matchesGearType(armor(2, 5), "cuir"), true);
    assert.equal(matchesGearType(armor(2, 5), "armure"), true);
    assert.equal(matchesGearType(armor(2, 5), "arme"), false);
    assert.equal(matchesGearType(armor(5, 1), "divers"), true);
    assert.equal(matchesGearType(weapon(7, 13), "epee-1m"), true);
    assert.equal(matchesGearType(weapon(7, 13), "epee-2m"), false);
    assert.equal(matchesGearSlot(armor(1, 20), "torse"), true, "robe");
    assert.equal(matchesGearSlot(armor(6, 14), "main-gauche"), true, "bouclier");
    assert.equal(matchesGearSlot(weapon(3, 26), "distance"), true, "fusil");
    assert.equal(matchesGearSlot(weapon(3, 26), "deux-mains"), false);
  });

  test("armures : tissu pour tous, cuir sans les lanceurs de sorts, mailles et plaques au niveau 40", () => {
    assert.equal(canUse(armor(1, 5), "MAGE"), true);
    assert.equal(canUse(armor(2, 5), "MAGE"), false);
    assert.equal(canUse(armor(2, 5), "DRUID"), true);
    // Une classe : ce qu'elle pourra porter ; un personnage : à son niveau.
    assert.equal(canUse(armor(3, 5), "HUNTER"), true);
    assert.equal(canUse(armor(3, 5, { requiredLevel: 30 }), "HUNTER", 39), false);
    assert.equal(canUse(armor(3, 5, { requiredLevel: 30 }), "HUNTER", 40), true);
    assert.equal(canUse(armor(3, 5, { requiredLevel: 30 }), "PALADIN", 30), true);
    assert.equal(canUse(armor(4, 5, { requiredLevel: 30 }), "WARRIOR", 39), false);
    assert.equal(canUse(armor(4, 5, { requiredLevel: 40 }), "WARRIOR", 40), true);
    assert.equal(canUse(armor(4, 5), "HUNTER"), false);
    assert.equal(canUse(armor(6, 14), "SHAMAN"), true);
    assert.equal(canUse(armor(6, 14), "PRIEST"), false);
    assert.equal(canUse(armor(8, 28), "DRUID"), true);
    assert.equal(canUse(armor(8, 28), "SHAMAN"), false);
  });

  test("armes que la classe peut apprendre, classes autorisées et niveau requis", () => {
    assert.equal(canUse(weapon(19, 26), "PRIEST"), true);
    assert.equal(canUse(weapon(19, 26), "WARRIOR"), false);
    assert.equal(canUse(weapon(15, 13), "MAGE"), true);
    assert.equal(canUse(weapon(0, 13), "ROGUE"), false, "pas de hache pour le voleur dans Classic");
    assert.equal(canUse(weapon(6, 17), "PALADIN"), true);
    assert.equal(canUse(weapon(20, 17), "MAGE"), true, "canne à pêche");
    assert.equal(canUse(armor(4, 5, { allowableClass: 2 }), "WARRIOR"), false);
    assert.equal(canUse(armor(4, 5, { allowableClass: 2 }), "PALADIN"), true);
    assert.equal(canUse(armor(1, 5, { requiredLevel: 25 }), "MAGE", 24), false);
    assert.equal(canUse(armor(1, 5, { requiredLevel: null }), "MAGE", 1), true);
    assert.equal(canUse(armor(1, 5), "DEMONHUNTER"), false);
  });
});
