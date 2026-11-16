import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { countByQuality, filledSlots, layoutPaperdoll, PAPERDOLL_COLUMNS } from "./paperdoll";
import { SLOT_LABELS } from "./format";

describe("fiche d'équipement", () => {
  test("les trois colonnes couvrent chacun des 19 emplacements du jeu, une seule fois", () => {
    const slots = Object.values(PAPERDOLL_COLUMNS).flat();
    assert.deepEqual(
      [...slots].sort((a, b) => a - b),
      Object.keys(SLOT_LABELS).map(Number),
    );
  });

  test("dans l'ordre de la fenêtre Personnage du jeu", () => {
    const labels = (slots: readonly number[]) => slots.map((slot) => SLOT_LABELS[slot]);
    assert.deepEqual(labels(PAPERDOLL_COLUMNS.left), ["Tête", "Cou", "Épaules", "Dos", "Torse", "Chemise", "Tabard", "Poignets"]);
    assert.deepEqual(labels(PAPERDOLL_COLUMNS.right), ["Mains", "Taille", "Jambes", "Pieds", "Doigt 1", "Doigt 2", "Bijou 1", "Bijou 2"]);
    assert.deepEqual(labels(PAPERDOLL_COLUMNS.weapons), ["Main droite", "Main gauche", "À distance"]);
  });

  test("chaque objet va à son emplacement ; un emplacement sans objet reste, vide", () => {
    const sheet = layoutPaperdoll([
      { slot: 16, name: "Épée" },
      { slot: 1, name: "Casque" },
      { slot: 14, name: "Bijou" },
    ]);
    assert.deepEqual(sheet.left[0], { slot: 1, item: { slot: 1, name: "Casque" } });
    assert.deepEqual(sheet.left[1], { slot: 2, item: null });
    assert.equal(sheet.right.at(-1)?.item?.name, "Bijou");
    assert.deepEqual(
      sheet.weapons.map((cell) => cell.item?.name ?? null),
      ["Épée", null, null],
    );
    assert.equal(sheet.left.filter((cell) => cell.item === null).length, 7);
  });

  test("aucun objet : la fiche montre tous les emplacements, vides", () => {
    const sheet = layoutPaperdoll([]);
    assert.equal(sheet.left.length + sheet.right.length + sheet.weapons.length, 19);
    assert.ok(Object.values(sheet).every((cells) => cells.every((cell) => cell.item === null)));
  });

  test("les qualités se comptent de la plus haute à la plus basse, l'inconnue à part", () => {
    assert.deepEqual(countByQuality([{ quality: 3 }, { quality: 4 }, { quality: null }, { quality: 3 }, { quality: 1 }]), [
      { quality: 4, count: 1 },
      { quality: 3, count: 2 },
      { quality: 1, count: 1 },
    ]);
    assert.deepEqual(countByQuality([]), []);
  });

  test("chemise et tabard ne comptent pas parmi les emplacements à garnir", () => {
    assert.deepEqual(filledSlots([{ slot: 1 }, { slot: 4 }, { slot: 19 }, { slot: 16 }]), { filled: 2, total: 17 });
    assert.deepEqual(filledSlots([]), { filled: 0, total: 17 });
  });
});
