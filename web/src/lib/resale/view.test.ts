import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { itemResults, premium, stockValue, type ResaleEvent } from "./view";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 20, 12, minutes));
const event = (kind: string, itemId: number, fields: Partial<ResaleEvent> = {}): ResaleEvent => ({
  kind,
  itemId,
  quantity: 1,
  amountCopper: null,
  feeCopper: null,
  gainCopper: null,
  depositCopper: null,
  occurredAt: at(0),
  ...fields,
});

describe("revente : bilan par objet", () => {
  test("achat, vente et invendu d'un objet ; base et rendement", () => {
    const [row] = itemResults([
      event("buy", 5266, { quantity: 2, amountCopper: 40_000 }),
      event("post", 5266, { quantity: 1 }),
      // Vente : 60 po brut, 3 po de commission, 37 po de gain : 20 po de coût d'achat.
      event("sale", 5266, { amountCopper: 60_000, feeCopper: 3_000, gainCopper: 37_000, occurredAt: at(30) }),
      event("expire", 5266, { depositCopper: 2_000, occurredAt: at(20) }),
    ]);
    assert.deepEqual(
      [row.boughtUnits, row.spentCopper, row.soldUnits, row.grossCopper, row.feesCopper, row.gainCopper, row.depositsLostCopper, row.basisCopper],
      [2, 40_000, 1, 60_000, 3_000, 37_000, 2_000, 20_000],
    );
    assert.equal(row.roi, (37_000 - 2_000) / 20_000);
    assert.deepEqual(row.lastAt, at(30));
  });

  test("sans vente, pas de rendement ; meilleur résultat net d'abord", () => {
    const rows = itemResults([
      event("buy", 1, { amountCopper: 500 }),
      event("cancel", 1, { depositCopper: 100 }),
      event("sale", 2, { amountCopper: 1_000, feeCopper: 50, gainCopper: 450 }),
      event("sale", 3, { amountCopper: 1_000, feeCopper: 50, gainCopper: -50 }),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.itemId, row.roi]),
      [
        [2, 450 / 500],
        [3, -50 / 1_000],
        [1, null],
      ],
    );
  });
});

describe("revente : stock", () => {
  test("valeur au marché et plus-value latente commission déduite, sur les seuls objets cotés", () => {
    const value = stockValue(
      [
        { quantity: 2, costCopper: 10_000, unitValue: 8_000 },
        { quantity: 1, costCopper: 5_000, unitValue: null },
      ],
      0.05,
    );
    assert.deepEqual(value, { invested: 15_000, value: 16_000, priced: 1, unrealized: 16_000 * 0.95 - 10_000 });
  });

  test("écart d'un prix demandé au marché", () => {
    assert.equal(premium(15_000, 10_000), 0.5);
    assert.equal(premium(12_000, null), null);
    assert.equal(premium(12_000, 0), null);
  });
});
