import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatMoneyInput, MAX_MONEY_COPPER, parseMoneyInput } from "./money-input";

const copper = (raw: string) => {
  const result = parseMoneyInput(raw);
  assert.ok(result.ok, `${raw} : ${result.ok ? "" : result.error}`);
  return result.value;
};

describe("saisie d'un montant", () => {
  test("vide : aucun montant", () => {
    assert.equal(copper(""), null);
    assert.equal(copper("   "), null);
  });

  test("pièces d'or, entières ou décimales, virgule ou point", () => {
    assert.equal(copper("12"), 120_000);
    assert.equal(copper("12,5"), 125_000);
    assert.equal(copper("0.0125"), 125);
  });

  test("unités françaises ou anglaises, avec ou sans espaces", () => {
    assert.equal(copper("12 po 50 pa 3 pc"), 125_003);
    assert.equal(copper("12po50pa"), 125_000);
    assert.equal(copper("50 pa"), 5_000);
    assert.equal(copper("7 pc"), 7);
    assert.equal(copper("1g 20s 5c"), 12_005);
    assert.equal(copper("  3 PO "), 30_000);
  });

  test("séparateurs de milliers tolérés, dont l'espace insécable du format français", () => {
    assert.equal(copper("1 200 po"), 12_000_000);
    assert.equal(copper("1 200 po 5 pa"), 12_000_500);
    assert.equal(copper("1 200"), 12_000_000);
  });

  test("formes refusées", () => {
    for (const raw of ["abc", "12 po po", "1 po 2 po", "-5", "12 pi", "1,2,3", "12 po 50", "po"]) {
      const result = parseMoneyInput(raw);
      assert.equal(result.ok, false, raw);
    }
    assert.deepEqual(parseMoneyInput("0"), { ok: false, error: "Le montant doit être supérieur à zéro." });
    assert.equal(parseMoneyInput("0,00001").ok, false);
    assert.equal(parseMoneyInput(String(MAX_MONEY_COPPER / 10_000 + 1)).ok, false);
    assert.equal(copper(String(MAX_MONEY_COPPER / 10_000)), MAX_MONEY_COPPER);
  });

  test("la forme affichée se relit à l'identique", () => {
    for (const value of [1, 99, 100, 5_000, 125_003, 120_000, 12_000_500]) {
      assert.equal(copper(formatMoneyInput(value)), value, formatMoneyInput(value));
    }
    assert.equal(formatMoneyInput(125_003), "12 po 50 pa 3 pc");
    assert.equal(formatMoneyInput(120_000), "12 po");
  });
});
