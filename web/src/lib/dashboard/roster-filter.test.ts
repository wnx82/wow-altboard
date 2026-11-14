import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { accountOptions, idParam, matchesRoster, param, readRosterFilter, rosterActive, textParam } from "./roster-filter";

describe("filtres des personnages", () => {
  test("paramètres de l'adresse : première valeur, identifiant en chiffres seulement", () => {
    assert.equal(param({ a: ["x", "y"] }, "a"), "x");
    assert.equal(param({}, "a"), "");
    assert.equal(idParam({ account: "12" }, "account"), 12);
    for (const value of ["0", "-3", "1e3", "12a", "", "1234567890"]) assert.equal(idParam({ account: value }, "account"), null, value);
  });

  test("texte cherché sans accent ni majuscule, borné à 40 caractères", () => {
    assert.deepEqual(textParam({ q: "  Élo  " }, "q"), { raw: "Élo", needle: "elo" });
    assert.equal(textParam({ q: "x".repeat(80) }, "q").raw.length, 40);
  });

  test("compte et nom combinés", () => {
    const filter = readRosterFilter({ account: "2", character: "AEG" });
    assert.equal(rosterActive(filter), true);
    assert.equal(matchesRoster({ name: "Ægir", accountId: 2 }, filter), false, "Æ n'est pas un A accentué");
    assert.equal(matchesRoster({ name: "Aegon", accountId: 2 }, filter), true);
    assert.equal(matchesRoster({ name: "Aegon", accountId: 1 }, filter), false);
    assert.equal(rosterActive(readRosterFilter({})), false);
    assert.equal(matchesRoster({ name: "N'importe", accountId: 9 }, readRosterFilter({})), true);
  });

  test("comptes proposés une fois chacun, par ordre alphabétique", () => {
    assert.deepEqual(
      accountOptions([
        { accountId: 2, account: "Zoé" },
        { accountId: 1, account: "Émile" },
        { accountId: 2, account: "Zoé" },
      ]),
      [
        { id: 1, label: "Émile" },
        { id: 2, label: "Zoé" },
      ],
    );
  });
});
