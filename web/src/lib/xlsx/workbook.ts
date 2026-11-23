import { zip } from "@/lib/zip";
import { PLAYER_TIME_ZONE } from "@/lib/wow/format";

// Classeur XLSX (Office Open XML) : feuilles à ligne d'en-tête figée et filtrable. Chaque cellule
// porte son type : un texte n'est jamais interprété comme une formule, même s'il commence par
// « = », « + », « - » ou « @ ».

export type Cell = string | number | boolean | Date | null | undefined;
export type Sheet = { name: string; columns: { header: string; width?: number }[]; rows: Cell[][] };

const escapeXml = (text: string) =>
  text
    // Caractères de contrôle interdits en XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A, B … Z, AA, AB … */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const brussels = new Intl.DateTimeFormat("en-CA", {
  timeZone: PLAYER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Numéro de série Excel de l'heure murale à Bruxelles (Excel ne connaît pas les fuseaux). */
function excelSerial(date: Date): number {
  const parts = Object.fromEntries(brussels.formatToParts(date).map((part) => [part.type, Number(part.value)]));
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wallClock / 86_400_000 + 25_569;
}

const STYLE_HEADER = 1;
const STYLE_DATE = 2;

function cellXml(value: Cell, reference: string, style = 0): string {
  const styled = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${reference}"${styled}><v>${value}</v></c>` : "";
  if (typeof value === "boolean") return `<c r="${reference}" t="b"${styled}><v>${value ? 1 : 0}</v></c>`;
  if (value instanceof Date) return `<c r="${reference}" s="${STYLE_DATE}"><v>${excelSerial(value)}</v></c>`;
  return `<c r="${reference}" t="inlineStr"${styled}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const lastColumn = columnName(Math.max(sheet.columns.length - 1, 0));
  const header = `<row r="1">${sheet.columns.map((column, index) => cellXml(column.header, `${columnName(index)}1`, STYLE_HEADER)).join("")}</row>`;
  const rows = sheet.rows
    .map((row, rowIndex) => `<row r="${rowIndex + 2}">${row.map((value, index) => cellXml(value, `${columnName(index)}${rowIndex + 2}`)).join("")}</row>`)
    .join("");
  const columns = sheet.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 16}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${columns}</cols>` +
    `<sheetData>${header}${rows}</sheetData>` +
    `<autoFilter ref="A1:${lastColumn}${sheet.rows.length + 1}"/>` +
    `</worksheet>`
  );
}

/** Nom de feuille valide : 31 caractères au plus, sans [ ] : * ? / \ */
const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`;

export function buildWorkbook(sheets: Sheet[]): Buffer {
  const names = sheets.map((sheet) => sheetName(sheet.name));
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    `</Types>`;
  const rootRelationships =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>` +
    `</workbook>`;
  const workbookRelationships =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRelationships },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelationships },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet) })),
  ]);
}
