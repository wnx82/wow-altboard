import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import { buildWorkbook } from "@/lib/xlsx/workbook";
import { FINANCE_PERIODS, type LedgerDayRow } from "./finances";
import type { InventoryData } from "./inventory";
import { DEFAULT_STATE, readInventoryState } from "./inventory-view";
import { describeFilters, financeSheets, inventorySheets, viewExportFileName } from "./view-export";

const NOW = new Date("2026-11-14T12:00:00Z");

async function read(sheets: Parameters<typeof buildWorkbook>[0]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buildWorkbook(sheets) as unknown as ArrayBuffer);
  return workbook;
}
// Array.from : une cellule vide devient undefined au lieu d'un trou dans le tableau.
const values = (sheet: ExcelJS.Worksheet, row: number) => Array.from(sheet.getRow(row).values as unknown[]).slice(1);

const DATA: InventoryData = {
  characters: [
    {
      id: 1,
      name: "Ada",
      realm: "Royaume",
      class: "MAGE",
      level: 60,
      account: { id: 10, label: "Compte A", featured: false },
      seen: { bags: null, bank: null, mail: null, auctions: null },
    },
    {
      id: 2,
      name: "Bob",
      realm: "Royaume",
      class: "WARRIOR",
      level: 30,
      account: { id: 20, label: "Compte B", featured: false },
      seen: { bags: null, bank: null, mail: null, auctions: null },
    },
  ],
  entries: [
    { characterId: 1, location: "bags", itemKey: "2589", quantity: 20, expiresAt: null },
    { characterId: 2, location: "mail", itemKey: "2589", quantity: 5, expiresAt: "2026-11-16T00:00:00Z" },
    { characterId: 2, location: "bags", itemKey: "6948", quantity: 1, expiresAt: null },
  ],
  guilds: [
    {
      id: 5,
      name: "Les Gardiens",
      realm: "Royaume",
      accountId: 10,
      accountLabel: "Compte A",
      moneyCopper: 0,
      seenAt: NOW.toISOString(),
      tabs: [{ index: 1, name: "Tissus", items: [{ itemKey: "2589", quantity: 40 }] }],
    },
  ],
  items: { "2589": { name: "Étoffe de lin", quality: 1, icon: null, category: "tissu" }, "6948": { name: "Pierre de foyer", quality: 1, icon: null } },
  prices: { "2589": 25 },
  market: { id: 1, label: "PvE" },
};

describe("export de la vue affichée", () => {
  test("Inventaires : mêmes filtres que la page, un objet par ligne puis le détail par détenteur", async () => {
    const state = readInventoryState(new URLSearchParams("q=etoffe&tri=quantite"));
    const workbook = await read(inventorySheets(DATA, state, NOW));

    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ["Résumé", "Objets", "Détail"],
    );
    const summary = workbook.getWorksheet("Résumé")!;
    assert.deepEqual(values(summary, 3), ["Filtres", "q=etoffe · tri=quantite"]);
    assert.deepEqual(values(summary, 4), ["Objets différents", 1]);
    assert.deepEqual(values(summary, 5), ["Exemplaires", 65]);
    assert.deepEqual(values(summary, 6), ["Valeur de marché (po)", 0.1625]);

    const items = workbook.getWorksheet("Objets")!;
    assert.equal(items.rowCount, 2);
    assert.deepEqual(values(items, 2), ["Étoffe de lin", "2589", "Commun", "Tissu", 65, 0.0025, 0.1625, "Les Gardiens × 40, Ada × 20, Bob × 5"]);

    const detail = workbook.getWorksheet("Détail")!;
    assert.deepEqual(
      [2, 3, 4].map((row) => values(detail, row).slice(2, 7)),
      [
        ["Les Gardiens", "Compte A", "Banque de guilde", "Tissus", 40],
        ["Ada", "Compte A", "Sacs", undefined, 20],
        ["Bob", "Compte B", "Courrier", undefined, 5],
      ],
    );
    assert.ok(values(detail, 4)[7] instanceof Date, "échéance du courrier");
  });

  test("Inventaires : un personnage choisi écarte les banques de guilde", async () => {
    const workbook = await read(inventorySheets(DATA, { ...DEFAULT_STATE, character: "2" }, NOW));
    const items = workbook.getWorksheet("Objets")!;
    assert.deepEqual(
      [2, 3].map((row) => values(items, row).slice(0, 5)),
      [
        ["Étoffe de lin", "2589", "Commun", "Tissu", 5],
        ["Pierre de foyer", "6948", "Commun", "Sans catégorie connue", 1],
      ],
    );
  });

  test("Finances : bilan, série par jour, personnages et journées de la période", async () => {
    const day = (characterId: number, date: string, income: Record<string, number>, expense: Record<string, number>, playedSeconds: number): LedgerDayRow => ({
      characterId,
      machineId: 1,
      day: date,
      income,
      expense,
      transferIn: 0,
      transferOut: 0,
      lootValue: null,
      playedSeconds,
    });
    const rows = [day(1, "2026-11-13", { quest: 50_000 }, { repair: 10_000 }, 3_600), day(2, "2026-11-14", { loot: 20_000 }, {}, 1_800)];
    const characters = new Map([
      [1, { id: 1, name: "Ada", class: "MAGE", account: "Compte A" }],
      [2, { id: 2, name: "Bob", class: "WARRIOR", account: "Compte B" }],
    ]);
    const period = FINANCE_PERIODS[0];
    const workbook = await read(financeSheets(rows, characters, period, "2026-11-08", "2026-11-14", NOW));

    assert.deepEqual(
      workbook.worksheets.map((sheet) => sheet.name),
      ["Bilan", "Par jour", "Par personnage", "Journées"],
    );
    const summary = workbook.getWorksheet("Bilan")!;
    assert.deepEqual(values(summary, 3), ["Période", "7 jours"]);
    assert.deepEqual(values(summary, 6), ["Revenus (po)", 7]);
    assert.deepEqual(values(summary, 7), ["Dépenses (po)", 1]);
    assert.deepEqual(values(summary, 8), ["Bilan (po)", 6]);
    assert.deepEqual(values(summary, 12), ["Temps de jeu (h)", 1.5]);
    // 7 jours affichés, jours sans activité compris.
    assert.equal(workbook.getWorksheet("Par jour")!.rowCount, 8);
    assert.deepEqual(values(workbook.getWorksheet("Par personnage")!, 2).slice(0, 6), ["Ada", "Mage", "Compte A", 5, 1, 4]);
    assert.deepEqual(values(workbook.getWorksheet("Journées")!, 2).slice(0, 5), ["2026-11-14", "Bob", "Compte B", 2, 0]);
  });

  test("nom du fichier au jour de Bruxelles, filtres lisibles", () => {
    assert.equal(viewExportFileName("inventaires", new Date("2026-11-14T23:30:00Z")), "AltBoard-inventaires-2026-11-15.xlsx");
    assert.equal(describeFilters(""), "aucun");
    assert.equal(describeFilters("?perso=2&lieux=sacs%2Cbanque"), "perso=2 · lieux=sacs,banque");
  });
});
