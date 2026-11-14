import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { buildWorkbook } from "@/lib/xlsx/workbook";
import { buildExport, exportFileName } from "./export";

// Les classeurs produits sont relus par une bibliothèque indépendante (exceljs, dépendance de
// test uniquement) : c'est elle qui atteste qu'un tableur réel saura les ouvrir.

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"),
);
const NOW = new Date("2026-10-04T14:00:00Z");

let database: TestDatabase;

async function read(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

const rowValues = (sheet: ExcelJS.Worksheet, row: number) => (sheet.getRow(row).values as unknown[]).slice(1);

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

test("le classeur contient une feuille par thème et les valeurs de la base", async () => {
  const { id } = await createAgentToken(database.db, "PC de test");
  await processSync(database.db, BASE, { tokenId: id, requestId: "test", now: NOW });
  const [mageRow] = await database.db.select({ id: t.characters.id }).from(t.characters).where(eq(t.characters.name, "Élodie Brisefer"));
  await database.db.insert(t.characterGoals).values([
    { characterId: mageRow.id, position: 0, label: "Niveau 30", kind: "level", params: { target: 30 } },
    { characterId: mageRow.id, position: 1, label: "Niveau 20", kind: "level", params: { target: 20 }, achievedAt: NOW },
  ]);

  const workbook = await read(await buildExport(database.db, NOW));

  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["Résumé", "Personnages", "Métiers", "Équipement", "Monnaies", "Réputations", "Objectifs", "Comptes", "Machines"],
  );

  const characters = workbook.getWorksheet("Personnages")!;
  assert.equal(characters.rowCount, 7);
  assert.deepEqual(rowValues(characters, 1).slice(0, 6), ["Nom", "Royaume", "Faction", "Classe", "Race", "Niveau"]);
  const mage = rowValues(characters, 2);
  assert.deepEqual(mage.slice(0, 6), ["Élodie Brisefer", "ClassicBetaPvE2", "Alliance", "Mage", "Éolide de l’Ordre suprême", 25]);
  assert.deepEqual([mage[8], mage[9], mage[10], mage[13], mage[14]], [16.25, 8.0964, 80964, "Compte 11…#1", "PC-FIXTURE"]);
  // Heure murale à Bruxelles du relevé en jeu (1791118113 = 4 octobre 2026, 14:48:33 heure d'été).
  assert.equal((mage[15] as Date).toISOString(), "2026-10-04T14:48:33.000Z");

  const count = (name: string) => workbook.getWorksheet(name)!.rowCount - 1;
  const total = (of: (c: SyncPayload["accounts"][number]["characters"][number]) => number) => BASE.accounts.flatMap((a) => a.characters).reduce((n, c) => n + of(c), 0);
  assert.equal(count("Métiers"), total((c) => c.professions.length));
  assert.equal(count("Équipement"), total((c) => c.gear.length));
  assert.equal(count("Réputations"), total((c) => c.reputations.length));
  assert.equal(count("Monnaies"), 1);
  assert.equal(count("Comptes"), 2);
  assert.equal(count("Machines"), 1);
  const goals = workbook.getWorksheet("Objectifs")!;
  assert.deepEqual(rowValues(goals, 2).slice(0, 6), ["Élodie Brisefer", "ClassicBetaPvE2", "Niveau 30", "Niveau", "25 / 30", "non"]);
  assert.deepEqual(rowValues(goals, 3).slice(0, 6), ["Élodie Brisefer", "ClassicBetaPvE2", "Niveau 20", "Niveau", "25 / 20", "oui"]);

  const summary = workbook.getWorksheet("Résumé")!;
  assert.deepEqual(rowValues(summary, 3), ["Personnages", 6]);
  assert.deepEqual(rowValues(summary, 4), ["Comptes", 2]);
});

test("une base vide donne un classeur valide, sans ligne de données", async () => {
  const workbook = await read(await buildExport(database.db, NOW));

  assert.equal(workbook.worksheets.length, 9);
  assert.equal(workbook.getWorksheet("Personnages")!.rowCount, 1);
  assert.deepEqual(rowValues(workbook.getWorksheet("Résumé")!, 3), ["Personnages", 0]);
});

test("un texte n'est jamais interprété comme une formule", async () => {
  const workbook = await read(
    buildWorkbook([
      {
        name: "Feuille: [test]/1 avec un nom beaucoup trop long pour Excel",
        columns: [{ header: "Texte" }, { header: "Nombre" }, { header: "Booléen" }, { header: "Date" }, { header: "Vide" }],
        rows: [
          ['=HYPERLINK("http://exemple.test";"clic")', 12.5, true, new Date("2026-01-15T11:30:00Z"), null],
          ["+1+1", -3, false, new Date("2026-07-15T10:30:00Z"), undefined],
          ["@SUM(A1) & <b>\"guillemets\"</b> \u0001 日本語 🐉 L’été", 0, true, null, ""],
        ],
      },
    ]),
  );

  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "Feuille   test  1 avec un nom b");
  assert.equal(sheet.getCell("A2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("A2").value, '=HYPERLINK("http://exemple.test";"clic")');
  assert.equal(sheet.getCell("A3").value, "+1+1");
  assert.equal(sheet.getCell("A4").value, '@SUM(A1) & <b>"guillemets"</b>  日本語 🐉 L’été');
  assert.deepEqual([sheet.getCell("B2").value, sheet.getCell("B3").value, sheet.getCell("B4").value], [12.5, -3, 0]);
  assert.deepEqual([sheet.getCell("C2").value, sheet.getCell("C3").value], [true, false]);
  // Heure d'hiver (UTC+1) puis heure d'été (UTC+2) à Bruxelles.
  assert.equal((sheet.getCell("D2").value as Date).toISOString(), "2026-01-15T12:30:00.000Z");
  assert.equal((sheet.getCell("D3").value as Date).toISOString(), "2026-07-15T12:30:00.000Z");
  assert.equal(sheet.getCell("E2").value, null);
});

test("le nom du fichier porte la date du jour à Bruxelles", () => {
  assert.equal(exportFileName(new Date("2026-10-04T14:00:00Z")), "AltBoard-export-2026-10-04.xlsx");
  assert.equal(exportFileName(new Date("2026-10-04T22:30:00Z")), "AltBoard-export-2026-10-05.xlsx");
});
