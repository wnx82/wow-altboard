import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByAccount } from "./account-groups";

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

const character = (name: string, accountId: number, accountLabel: string, level: number | null, moneyCopper: number | null, featured = false) => ({
  name,
  account: { id: accountId, label: accountLabel, featured },
  level,
  moneyCopper,
});

test("les personnages sont regroupés par compte, blocs rangés par libellé", () => {
  const groups = groupByAccount(
    [
      character("Zoé", 2, "Écaille", 60, 500),
      character("Ægir", 1, "Zèbre", 12, 30),
      character("Noël", 2, "Écaille", 20, 250),
      character("Élodie", 3, "compte 10", 5, 1),
      character("Brise", 4, "Compte 9", 5, 1),
    ],
    collator.compare,
  );

  assert.deepEqual(
    groups.map((group) => group.account.label),
    ["Compte 9", "compte 10", "Écaille", "Zèbre"],
  );
  // L'ordre reçu, celui du tri choisi, est conservé dans le bloc.
  assert.deepEqual(
    groups[2].members.map((member) => member.name),
    ["Zoé", "Noël"],
  );
});

test("chaque bloc porte son or total et son niveau le plus élevé", () => {
  const [group] = groupByAccount([character("A", 1, "Compte", 20, 10_000), character("B", 1, "Compte", 60, 284), character("C", 1, "Compte", 7, 0)], collator.compare);

  assert.equal(group.totalCopper, 10_284);
  assert.equal(group.topLevel, 60);
});

test("une donnée absente n'est ni comptée comme zéro ni inventée", () => {
  const [partial, unknown] = groupByAccount(
    [character("A", 1, "Alpha", null, null), character("B", 1, "Alpha", 8, 150), character("C", 2, "Bêta", null, null)],
    collator.compare,
  );

  assert.equal(partial.totalCopper, 150);
  assert.equal(partial.topLevel, 8);
  assert.equal(unknown.totalCopper, null);
  assert.equal(unknown.topLevel, null);
});

test("deux comptes de même libellé restent deux blocs", () => {
  const groups = groupByAccount([character("A", 7, "Compte", 1, 1), character("B", 3, "Compte", 1, 1)], collator.compare);

  assert.deepEqual(
    groups.map((group) => group.account.id),
    [3, 7],
  );
});

test("les comptes mis en avant passent devant, rangés entre eux par libellé", () => {
  const groups = groupByAccount(
    [
      character("A", 1, "Alpha", 1, 1),
      character("B", 2, "Zèbre", 30, 1, true),
      character("C", 3, "Bêta", 1, 1),
      character("D", 4, "Yack", 30, 1, true),
    ],
    collator.compare,
  );

  assert.deepEqual(
    groups.map((group) => group.account.label),
    ["Yack", "Zèbre", "Alpha", "Bêta"],
  );
});
