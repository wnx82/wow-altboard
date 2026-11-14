import { categoryLabel } from "@/lib/wow/item-categories";
import { classLabel, QUALITY_LABELS } from "@/lib/wow/format";
import type { Cell, Sheet } from "@/lib/xlsx/workbook";
import {
  buckets,
  byCharacter,
  EXPENSE_LABELS,
  goldPerHour,
  INCOME_LABELS,
  summarize,
  type ExpenseSource,
  type FinancePeriod,
  type FinanceTotals,
  type IncomeSource,
  type LedgerDayRow,
} from "./finances";
import type { InventoryData } from "./inventory";
import { groupByItem, holdingPlace, holdingsValue, PLACE_LABELS, selectHoldings, writeInventoryState, type Holding, type InventoryState } from "./inventory-view";
import type { FinanceCharacter } from "./queries";

// Export Excel de la vue affichée : mêmes filtres et même tri que la page, relus dans l'adresse.
// Pur, sans base : les routes chargent les données puis appellent ces fonctions.

/** Pièces de cuivre en pièces d'or, comme l'export complet. */
const gold = (copper: number | null) => (copper === null ? null : copper / 10_000);
const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
const quality = (value: number | null) => (value === null ? null : (QUALITY_LABELS[value] ?? String(value)));

const brusselsDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" });

export const viewExportFileName = (view: "inventaires" | "finances", now: Date) => `AltBoard-${view}-${brusselsDay.format(now)}.xlsx`;

/** Filtres de la vue, lisibles : « q=épée · lieux=sacs », ou « aucun ». */
export function describeFilters(search: string): string {
  const params = [...new URLSearchParams(search)].map(([name, value]) => `${name}=${value}`);
  return params.length === 0 ? "aucun" : params.join(" · ");
}

export function inventorySheets(data: InventoryData, state: InventoryState, now: Date): Sheet[] {
  const holdings = selectHoldings(data, state, now);
  const rows = groupByItem(holdings, data.items, state.sort, data.prices);
  const characters = new Map(data.characters.map((character) => [character.id, character]));
  const guilds = new Map(data.guilds.map((guild) => [guild.id, guild]));
  const worth = holdingsValue(holdings, data.prices, now);

  const holder = (holding: Holding): { name: string; account: string | null; tab: string | null } => {
    if (holding.kind === "character") {
      const character = characters.get(holding.characterId);
      return { name: character?.name ?? `Personnage ${holding.characterId}`, account: character?.account.label ?? null, tab: null };
    }
    const guild = guilds.get(holding.guildId);
    const tabName = guild?.tabs.find((tab) => tab.index === holding.tab)?.name;
    return { name: guild?.name ?? `Guilde ${holding.guildId}`, account: guild?.accountLabel ?? null, tab: tabName ?? `Onglet ${holding.tab}` };
  };
  const itemName = (itemKey: string) => data.items[itemKey]?.name ?? `Objet ${itemKey}`;

  return [
    {
      name: "Résumé",
      columns: [{ header: "Indicateur", width: 30 }, { header: "Valeur", width: 60 }],
      rows: [
        ["Date de l'export", now],
        ["Filtres", describeFilters(writeInventoryState(state))],
        ["Objets différents", rows.length],
        ["Exemplaires", holdings.reduce((sum, holding) => sum + holding.quantity, 0)],
        ["Valeur de marché (po)", data.market ? gold(worth.value) : null],
        ["Exemplaires sans prix connu", data.market ? worth.unpriced : null],
        ["Hôtel des ventes des prix", data.market?.label ?? "aucun prix reçu"],
      ],
    },
    {
      name: "Objets",
      columns: [
        { header: "Objet", width: 40 },
        { header: "Identifiant", width: 16 },
        { header: "Qualité", width: 12 },
        { header: "Catégorie", width: 26 },
        { header: "Quantité", width: 11 },
        { header: "Prix unitaire (po)", width: 18 },
        { header: "Valeur (po)", width: 14 },
        { header: "Détenteurs", width: 60 },
      ],
      rows: rows.map((row) => [
        itemName(row.itemKey),
        row.itemKey,
        quality(row.quality),
        categoryLabel(data.items[row.itemKey]?.category),
        row.total,
        gold(row.unit),
        gold(row.value),
        row.holdings.map((holding) => `${holder(holding).name} × ${holding.quantity}`).join(", "),
      ]),
    },
    {
      name: "Détail",
      columns: [
        { header: "Objet", width: 40 },
        { header: "Identifiant", width: 16 },
        { header: "Détenteur", width: 26 },
        { header: "Compte", width: 20 },
        { header: "Endroit", width: 18 },
        { header: "Onglet", width: 18 },
        { header: "Quantité", width: 11 },
        { header: "Échéance", width: 20 },
      ],
      rows: rows.flatMap((row) =>
        row.holdings.map<Cell[]>((holding) => {
          const who = holder(holding);
          return [
            itemName(row.itemKey),
            row.itemKey,
            who.name,
            who.account,
            PLACE_LABELS[holdingPlace(holding)],
            who.tab,
            holding.quantity,
            holding.kind === "character" && holding.expiresAt ? new Date(holding.expiresAt) : null,
          ];
        }),
      ),
    },
  ];
}

const INCOME_KEYS = Object.keys(INCOME_LABELS) as IncomeSource[];
const EXPENSE_KEYS = Object.keys(EXPENSE_LABELS) as ExpenseSource[];
const sourceColumns = [
  ...INCOME_KEYS.map((source) => ({ header: `Revenus : ${INCOME_LABELS[source]} (po)`, width: 18 })),
  ...EXPENSE_KEYS.map((source) => ({ header: `Dépenses : ${EXPENSE_LABELS[source]} (po)`, width: 18 })),
];
const sourceCells = (income: Record<string, number>, expense: Record<string, number>): Cell[] => [
  ...INCOME_KEYS.map((source) => gold(income[source] ?? 0)),
  ...EXPENSE_KEYS.map((source) => gold(expense[source] ?? 0)),
];
const totalsCells = (totals: FinanceTotals): Cell[] => {
  const rate = goldPerHour(totals);
  return [gold(totals.income), gold(totals.expense), gold(totals.net), hours(totals.playedSeconds), rate === null ? null : gold(rate), totals.days];
};
const totalsColumns = [
  { header: "Revenus (po)", width: 14 },
  { header: "Dépenses (po)", width: 14 },
  { header: "Bilan (po)", width: 14 },
  { header: "Temps de jeu (h)", width: 16 },
  { header: "Or par heure (po)", width: 17 },
  { header: "Journées jouées", width: 16 },
];

/**
 * Finances de la période affichée. `rows` : journées distinctes de la période seulement (sans la
 * période précédente que la page lit pour comparer).
 */
export function financeSheets(
  rows: readonly LedgerDayRow[],
  characters: ReadonlyMap<number, FinanceCharacter>,
  period: FinancePeriod,
  from: string | null,
  today: string,
  now: Date,
): Sheet[] {
  const totals = summarize(rows);
  const grouping = period.days === null ? "month" : "day";
  const series = buckets(rows, grouping, from, today);
  const who = (characterId: number) => characters.get(characterId);

  return [
    {
      name: "Bilan",
      columns: [{ header: "Indicateur", width: 34 }, { header: "Valeur", width: 22 }],
      rows: [
        ["Date de l'export", now],
        ["Période", period.label],
        ["Du", from ?? rows.map((row) => row.day).sort()[0] ?? null],
        ["Au", today],
        ["Revenus (po)", gold(totals.income)],
        ["Dépenses (po)", gold(totals.expense)],
        ["Bilan (po)", gold(totals.net)],
        ["Transferts reçus de vos personnages (po)", gold(totals.transferIn)],
        ["Transferts envoyés à vos personnages (po)", gold(totals.transferOut)],
        ["Valeur du butin ramassé (po)", gold(totals.lootValue)],
        ["Temps de jeu (h)", hours(totals.playedSeconds)],
        ["Or par heure (po)", gold(goldPerHour(totals))],
        ["Journées jouées", totals.days],
        ...INCOME_KEYS.map<Cell[]>((source) => [`Revenus : ${INCOME_LABELS[source]} (po)`, gold(totals.incomeBySource[source])]),
        ...EXPENSE_KEYS.map<Cell[]>((source) => [`Dépenses : ${EXPENSE_LABELS[source]} (po)`, gold(totals.expenseBySource[source])]),
      ],
    },
    {
      name: grouping === "day" ? "Par jour" : "Par mois",
      columns: [
        { header: grouping === "day" ? "Jour" : "Mois", width: 12 },
        { header: "Revenus (po)", width: 14 },
        { header: "Dépenses (po)", width: 14 },
        { header: "Bilan (po)", width: 14 },
        { header: "Temps de jeu (h)", width: 16 },
        { header: "Journées jouées", width: 16 },
      ],
      rows: series.map((bucket) => [bucket.key, gold(bucket.income), gold(bucket.expense), gold(bucket.net), hours(bucket.playedSeconds), bucket.days]),
    },
    {
      name: "Par personnage",
      columns: [{ header: "Personnage", width: 26 }, { header: "Classe", width: 16 }, { header: "Compte", width: 20 }, ...totalsColumns, ...sourceColumns],
      rows: byCharacter(rows).map(({ characterId, totals: own }) => [
        who(characterId)?.name ?? `Personnage ${characterId}`,
        classLabel(who(characterId)?.class ?? null),
        who(characterId)?.account ?? null,
        ...totalsCells(own),
        ...sourceCells(own.incomeBySource, own.expenseBySource),
      ]),
    },
    {
      name: "Journées",
      columns: [
        { header: "Jour", width: 12 },
        { header: "Personnage", width: 26 },
        { header: "Compte", width: 20 },
        { header: "Revenus (po)", width: 14 },
        { header: "Dépenses (po)", width: 14 },
        { header: "Transferts reçus (po)", width: 18 },
        { header: "Transferts envoyés (po)", width: 18 },
        { header: "Valeur du butin (po)", width: 18 },
        { header: "Temps de jeu (h)", width: 16 },
        ...sourceColumns,
      ],
      rows: [...rows]
        .sort((a, b) => b.day.localeCompare(a.day) || a.characterId - b.characterId)
        .map((row) => {
          const own = summarize([row]);
          return [
            row.day,
            who(row.characterId)?.name ?? `Personnage ${row.characterId}`,
            who(row.characterId)?.account ?? null,
            gold(own.income),
            gold(own.expense),
            gold(row.transferIn),
            gold(row.transferOut),
            gold(row.lootValue),
            row.playedSeconds === null ? null : hours(row.playedSeconds),
            ...sourceCells(row.income, row.expense),
          ];
        }),
    },
  ];
}
