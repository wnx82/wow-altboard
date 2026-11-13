import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { categoryLabel, categoryRank, CATEGORY_GROUPS, isItemCategory, ITEM_CATEGORIES, itemCategory } from "./item-categories";

const spec = (itemClass: number, subclass = 0) => ({ itemClass, subclass });

describe("catégories d'objets", () => {
  test("classe et sous-classe de la table Item", () => {
    assert.equal(itemCategory(spec(2, 7), 2), "armes");
    assert.equal(itemCategory(spec(4, 2), 1), "armures");
    assert.equal(itemCategory(spec(1, 0), 1), "sacs");
    assert.equal(itemCategory(spec(11, 2), 1), "sacs", "carquois");
    assert.equal(itemCategory(spec(0, 5), 1), "nourriture");
    assert.equal(itemCategory(spec(0, 1), 1), "potions");
    assert.equal(itemCategory(spec(0, 3), 1), "elixirs", "flacon");
    assert.equal(itemCategory(spec(0, 4), 1), "parchemins");
    assert.equal(itemCategory(spec(0, 7), 1), "bandages");
    assert.equal(itemCategory(spec(0, 6), 1), "ameliorations");
    assert.equal(itemCategory(spec(0, 8), 1), "consommables");
    assert.equal(itemCategory(spec(6, 2), 1), "munitions");
    assert.equal(itemCategory(spec(7, 5), 1), "tissu");
    assert.equal(itemCategory(spec(7, 6), 1), "cuir");
    assert.equal(itemCategory(spec(7, 7), 1), "metal");
    assert.equal(itemCategory(spec(7, 8), 1), "viande");
    assert.equal(itemCategory(spec(7, 9), 1), "herbes");
    assert.equal(itemCategory(spec(7, 10), 1), "elementaire");
    assert.equal(itemCategory(spec(7, 12), 1), "enchantement");
    assert.equal(itemCategory(spec(7, 1), 1), "ingenierie");
    assert.equal(itemCategory(spec(7, 11), 1), "artisanat");
    assert.equal(itemCategory(spec(3, 1), 2), "artisanat", "gemme");
    assert.equal(itemCategory(spec(9, 1), 1), "recettes");
    assert.equal(itemCategory(spec(5), 1), "reactifs");
    assert.equal(itemCategory(spec(15, 1), 1), "reactifs");
    assert.equal(itemCategory(spec(12), 1), "quete");
    assert.equal(itemCategory(spec(13), 1), "cles");
    assert.equal(itemCategory(spec(15, 2), 1), "mascottes");
    assert.equal(itemCategory(spec(15, 5), 4), "mascottes", "monture");
    assert.equal(itemCategory(spec(15, 0), 1), "divers");
    assert.equal(itemCategory(spec(18), 1), "divers", "jeton WoW");
  });

  test("la camelote l'emporte ; une mascotte se reconnaît à sa clé ; sinon, sans catégorie", () => {
    assert.equal(itemCategory(spec(2, 7), 0), "camelote");
    assert.equal(itemCategory(null, 0), "camelote");
    assert.equal(itemCategory(undefined, null, "p:42"), "mascottes");
    assert.equal(itemCategory(undefined, 1, "999"), "inconnu");
    assert.equal(itemCategory(spec(7, 6), null), "cuir", "qualité inconnue");
  });

  test("ordre, libellés et groupes", () => {
    assert.equal(new Set(ITEM_CATEGORIES.map((category) => category.value)).size, ITEM_CATEGORIES.length);
    assert.ok(categoryRank("armes") < categoryRank("cuir"));
    assert.ok(categoryRank("cuir") < categoryRank("camelote"));
    assert.equal(categoryRank("inconnu"), ITEM_CATEGORIES.length - 1);
    assert.equal(categoryRank(undefined), ITEM_CATEGORIES.length - 1);
    assert.equal(categoryLabel("elixirs"), "Élixirs et flacons");
    assert.equal(categoryLabel(undefined), "Sans catégorie connue");
    assert.equal(isItemCategory("cuir"), true);
    assert.equal(isItemCategory("bidon"), false);
    assert.deepEqual(CATEGORY_GROUPS, ["Équipement", "Consommables", "Artisanat", "Autres"]);
    // Chaque groupe est d'un seul tenant : l'ordre des catégories suit celui des groupes.
    const groups = ITEM_CATEGORIES.map((category) => category.group);
    assert.deepEqual(groups, [...groups].sort((a, b) => CATEGORY_GROUPS.indexOf(a) - CATEGORY_GROUPS.indexOf(b)));
  });
});
