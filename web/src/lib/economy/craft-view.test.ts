import assert from "node:assert/strict";
import { test } from "node:test";
import type { CraftDecision, CraftEvaluation } from "./craft";
import { craftFilterActive, craftHref, filterCraftRows, groupByProfession, NO_CRAFT_FILTER, readCraftFilter, sortCrafts, type CraftRow } from "./craft-view";

function row(spellId: number, skillLine: number | null, decision: CraftDecision, extra: { profit?: number | null; output?: string; reagents?: string[]; characters?: string[] } = {}): CraftRow {
  const craft = {
    spellId,
    outputKey: extra.output ?? String(spellId),
    outputQuantity: 1,
    reagents: (extra.reagents ?? []).map((itemKey) => ({ itemKey, quantity: 1, source: "hôtel des ventes", unitMarket: 1, unitPrudent: 1, unitSellNet: 1, owned: 0, confidence: 50 })),
    profit: extra.profit ?? null,
    batchProfit: extra.profit ?? null,
    decision,
  } as unknown as CraftEvaluation;
  return {
    craft,
    recipe: {
      spellId,
      skillLine,
      outputItemId: spellId,
      outputQuantity: 1,
      cooldown: false,
      reagents: [],
      characters: (extra.characters ?? ["Aedot"]).map((name, index) => ({ id: index + 1, name, class: "MAGE" })),
    },
  };
}

const NAMES: Record<string, string> = { "100": "Potion de soins", "200": "Éclat de bronze", "300": "Racine sauvage" };
const name = (key: string) => NAMES[key] ?? `Objet ${key}`;

test("lecture des filtres : valeurs illisibles ignorées, recherche bornée", () => {
  assert.deepEqual(readCraftFilter({}), NO_CRAFT_FILTER);
  assert.deepEqual(readCraftFilter({ decision: "CRAFT", stock: "1", profession: "171", q: "  potion " }), {
    decision: "CRAFT",
    stock: true,
    profession: 171,
    query: "potion",
  });
  assert.deepEqual(readCraftFilter({ decision: "craft", stock: "oui", profession: "-3", q: ["a", "b"] }), NO_CRAFT_FILTER);
  assert.equal(readCraftFilter({ profession: "none" }).profession, "none");
  assert.equal(readCraftFilter({ q: "x".repeat(60) }).query.length, 40);
  assert.equal(craftFilterActive(NO_CRAFT_FILTER), false);
  assert.equal(craftFilterActive({ ...NO_CRAFT_FILTER, stock: true }), true);
});

test("adresse : paramètres présents seulement, marché en dernier", () => {
  assert.equal(craftHref(NO_CRAFT_FILTER), "/crafting");
  assert.equal(craftHref(NO_CRAFT_FILTER, 4), "/crafting?market=4");
  assert.equal(craftHref({ decision: "WAIT", stock: true, profession: 171, query: "épée longue" }, 2), "/crafting?q=%C3%A9p%C3%A9e+longue&profession=171&decision=WAIT&stock=1&market=2");
  // Aller-retour : l'adresse relue redonne les mêmes filtres.
  const filter = { decision: "CRAFT" as const, stock: false, profession: "none" as const, query: "racine" };
  const params = Object.fromEntries(new URL(craftHref(filter), "http://x").searchParams);
  assert.deepEqual(readCraftFilter(params), filter);
});

test("recherche sur le produit, les composants et les personnages, sans accents", () => {
  const rows = [
    row(1, 171, "CRAFT", { output: "100", reagents: ["300"], characters: ["Aedot"] }),
    row(2, 164, "WAIT", { output: "999", reagents: ["200"], characters: ["Brakka"] }),
  ];
  const ids = (filter: Partial<typeof NO_CRAFT_FILTER>) => filterCraftRows(rows, { ...NO_CRAFT_FILTER, ...filter }, name, () => true).map((r) => r.craft.spellId);
  assert.deepEqual(ids({ query: "POTION" }), [1]);
  assert.deepEqual(ids({ query: "eclat" }), [2]);
  assert.deepEqual(ids({ query: "brak" }), [2]);
  assert.deepEqual(ids({ query: "objet 999" }), [2]);
  assert.deepEqual(ids({ query: "zzz" }), []);
});

test("filtres combinés : décision, métier (dont sans métier) et stocks", () => {
  const rows = [row(1, 171, "CRAFT"), row(2, 171, "WAIT"), row(3, null, "CRAFT"), row(4, 164, "CRAFT")];
  const craftable = (r: CraftRow) => r.craft.spellId !== 4;
  const ids = (filter: Partial<typeof NO_CRAFT_FILTER>) => filterCraftRows(rows, { ...NO_CRAFT_FILTER, ...filter }, name, craftable).map((r) => r.craft.spellId);
  assert.deepEqual(ids({ decision: "CRAFT" }), [1, 3, 4]);
  assert.deepEqual(ids({ profession: 171 }), [1, 2]);
  assert.deepEqual(ids({ profession: "none" }), [3]);
  assert.deepEqual(ids({ decision: "CRAFT", stock: true }), [1, 3]);
});

test("regroupement par métier : métiers rentables d'abord, recettes à crafter en tête", () => {
  const rows = sortCrafts([
    row(1, 164, "WAIT"),
    row(2, 171, "CRAFT", { profit: 50 }),
    row(3, 164, "CRAFT", { profit: 500 }),
    row(4, 171, "DONT_CRAFT"),
    row(5, 171, "CRAFT", { profit: 80 }),
  ]);
  const groups = groupByProfession(rows, (skill) => (skill === 164 ? "Forge" : "Alchimie"));
  assert.deepEqual(
    groups.map((group) => group.summary.name),
    ["Forge", "Alchimie"],
  );
  assert.deepEqual(
    groups[1].rows.map((r) => r.craft.spellId),
    [5, 2, 4],
  );
  assert.deepEqual(groups[1].counts, { CRAFT: 2, SELL_REAGENTS: 0, WAIT: 0, DONT_CRAFT: 1 });
  assert.equal(groups[0].summary.profitable, 1);
});
