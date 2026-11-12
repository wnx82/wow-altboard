import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { matchRank, searchNeedle } from "./global-search";

describe("recherche globale : texte cherché et pertinence", () => {
  test("deux lettres au moins, ou un identifiant ; sans accent ni majuscule", () => {
    assert.equal(searchNeedle("e"), null);
    assert.equal(searchNeedle("  "), null);
    assert.equal(searchNeedle(null), null);
    assert.equal(searchNeedle("7"), "7");
    assert.equal(searchNeedle("  Épée   Large "), "epee large");
    assert.equal(searchNeedle("x".repeat(100))?.length, 60);
  });

  test("début du nom, puis début d'un mot, puis ailleurs", () => {
    assert.equal(matchRank("Lingot de cuivre", "lin"), 0);
    assert.equal(matchRank("Étoffe de lin", "lin"), 1);
    assert.equal(matchRank("Patron : Gilet rouge en lin", "lin"), 1);
    assert.equal(matchRank("Palourdes gobelines", "lin"), 2);
    assert.equal(matchRank("Élixir de l'Épée", "epee"), 1);
  });
});
