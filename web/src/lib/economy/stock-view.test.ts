import assert from "node:assert/strict";
import { test } from "node:test";
import { craftableNow, holdingPlace, stockStatus } from "./stock-view";

const reagent = (itemKey: string, quantity: number, owned: number, source: "marchand" | "hôtel des ventes" | "inconnu" = "hôtel des ventes") => ({
  itemKey,
  quantity,
  owned,
  source,
});

test("tout en stock : nombre de fabrications fixé par le composant le plus rare", () => {
  const status = stockStatus([reagent("cuir", 2, 7), reagent("fil", 1, 10)]);
  assert.deepEqual(status, { kind: "complete", crafts: 3, missing: [] });
  assert.equal(craftableNow(status), true);
});

test("il ne manque qu'un composant de marchand : faisable sans l'hôtel des ventes", () => {
  const status = stockStatus([reagent("cuir", 2, 2), reagent("fil", 1, 0, "marchand")]);
  assert.equal(status.kind, "vendor");
  assert.deepEqual(status.missing.map((r) => r.itemKey), ["fil"]);
  assert.equal(craftableNow(status), true);
  // Rien en stock mais tout chez un marchand : faisable aussi.
  assert.equal(stockStatus([reagent("fil", 1, 0, "marchand")]).kind, "vendor");
});

test("en partie, ou rien : les composants manquants sont listés", () => {
  const partial = stockStatus([reagent("cuir", 4, 3), reagent("fil", 1, 0, "marchand"), reagent("teinture", 1, 1)]);
  assert.equal(partial.kind, "partial");
  assert.deepEqual(partial.missing.map((r) => r.itemKey), ["cuir", "fil"]);
  assert.equal(craftableNow(partial), false);

  const none = stockStatus([reagent("cuir", 4, 0), reagent("fil", 1, 0, "marchand")]);
  assert.equal(none.kind, "none");
  assert.equal(craftableNow(none), false);
  assert.equal(stockStatus([]).kind, "none");
});

test("emplacement du stock d'un personnage", () => {
  assert.equal(holdingPlace({ bags: 6, bank: 0 }), "sacs");
  assert.equal(holdingPlace({ bags: 0, bank: 6 }), "banque");
  assert.equal(holdingPlace({ bags: 1200, bank: 4 }, (value) => new Intl.NumberFormat("fr-FR").format(value)), "sacs 1 200, banque 4");
});
