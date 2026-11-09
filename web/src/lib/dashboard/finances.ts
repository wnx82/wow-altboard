import { addDays } from "@/lib/economy/days";
import { EXPENSE_SOURCES, INCOME_SOURCES } from "@/lib/sync/schema";

// Finances de tous les personnages, à partir des journées d'Allemano Ledger : revenus et dépenses
// par source, par personnage et par jour ou par mois. Pur, sans base. Les transferts entre
// personnages du même joueur ne sont ni des revenus ni des dépenses : ils sont comptés à part.

export type IncomeSource = (typeof INCOME_SOURCES)[number];
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const INCOME_LABELS: Record<IncomeSource, string> = {
  loot: "Pièces ramassées",
  vendor: "Ventes au marchand",
  quest: "Quêtes",
  ah: "Hôtel des ventes",
  mail: "Courrier",
  trade: "Échanges",
  other: "Autres",
};

export const EXPENSE_LABELS: Record<ExpenseSource, string> = {
  repair: "Réparations",
  vendor: "Achats au marchand",
  training: "Apprentissage",
  travel: "Voyages",
  ah: "Hôtel des ventes",
  mail: "Courrier",
  trade: "Échanges",
  other: "Autres",
};

export type FinancePeriod = { key: "7" | "30" | "90" | "all"; days: number | null; label: string };
export const FINANCE_PERIODS: readonly FinancePeriod[] = [
  { key: "7", days: 7, label: "7 jours" },
  { key: "30", days: 30, label: "30 jours" },
  { key: "90", days: 90, label: "90 jours" },
  { key: "all", days: null, label: "Tout" },
];
const DEFAULT_PERIOD = FINANCE_PERIODS[1];

/** Temps de jeu en deçà duquel l'or par heure n'est pas calculé : sur quelques minutes, il ne dirait rien. */
export const MIN_SECONDS_FOR_RATE = 30 * 60;

/** Période d'un paramètre d'URL ; 30 jours par défaut. */
export function financePeriod(value: string | string[] | undefined): FinancePeriod {
  return FINANCE_PERIODS.find((period) => period.key === value) ?? DEFAULT_PERIOD;
}

/** Premier jour de la période se terminant aujourd'hui, ou null pour tout l'historique. */
export function periodStart(period: FinancePeriod, today: string): string | null {
  return period.days === null ? null : addDays(today, -(period.days - 1));
}

export type LedgerDayRow = {
  characterId: number;
  machineId: number;
  day: string;
  income: Record<string, number>;
  expense: Record<string, number>;
  transferIn: number;
  transferOut: number;
  lootValue: number | null;
  playedSeconds: number | null;
};

export type FinanceTotals = {
  income: number;
  expense: number;
  net: number;
  transferIn: number;
  transferOut: number;
  lootValue: number;
  playedSeconds: number;
  /** Journées distinctes jouées. */
  days: number;
  incomeBySource: Record<IncomeSource, number>;
  expenseBySource: Record<ExpenseSource, number>;
};

const zeroes = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
const sumOf = (amounts: Record<string, number>) => Object.values(amounts).reduce((total, value) => total + value, 0);

/**
 * Une même journée reçue de deux PC avec des valeurs identiques vient d'un fichier copié d'un PC à
 * l'autre (dossier WTF synchronisé) : elle n'est comptée qu'une fois. Deux PC qui ont réellement
 * joué le même jour ont des chiffres différents, et s'additionnent.
 */
export function distinctDays(rows: readonly LedgerDayRow[]): LedgerDayRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = JSON.stringify([
      row.characterId,
      row.day,
      Object.entries(row.income).sort(),
      Object.entries(row.expense).sort(),
      row.transferIn,
      row.transferOut,
      row.lootValue,
      row.playedSeconds,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarize(rows: readonly LedgerDayRow[]): FinanceTotals {
  const totals: FinanceTotals = {
    income: 0,
    expense: 0,
    net: 0,
    transferIn: 0,
    transferOut: 0,
    lootValue: 0,
    playedSeconds: 0,
    days: new Set(rows.map((row) => row.day)).size,
    incomeBySource: zeroes(INCOME_SOURCES),
    expenseBySource: zeroes(EXPENSE_SOURCES),
  };
  for (const row of rows) {
    for (const source of INCOME_SOURCES) totals.incomeBySource[source] += row.income[source] ?? 0;
    for (const source of EXPENSE_SOURCES) totals.expenseBySource[source] += row.expense[source] ?? 0;
    totals.transferIn += row.transferIn;
    totals.transferOut += row.transferOut;
    totals.lootValue += row.lootValue ?? 0;
    totals.playedSeconds += row.playedSeconds ?? 0;
  }
  totals.income = sumOf(totals.incomeBySource);
  totals.expense = sumOf(totals.expenseBySource);
  totals.net = totals.income - totals.expense;
  return totals;
}

/** Bilan par heure de jeu, en pièces de cuivre ; null sous MIN_SECONDS_FOR_RATE. */
export function goldPerHour(totals: Pick<FinanceTotals, "net" | "playedSeconds">): number | null {
  return totals.playedSeconds < MIN_SECONDS_FOR_RATE ? null : Math.round(totals.net / (totals.playedSeconds / 3600));
}

/** Totaux par personnage, le meilleur bilan d'abord. */
export function byCharacter(rows: readonly LedgerDayRow[]): { characterId: number; totals: FinanceTotals }[] {
  const groups = new Map<number, LedgerDayRow[]>();
  for (const row of rows) groups.set(row.characterId, [...(groups.get(row.characterId) ?? []), row]);
  return [...groups]
    .map(([characterId, group]) => ({ characterId, totals: summarize(group) }))
    .sort((a, b) => b.totals.net - a.totals.net || b.totals.income - a.totals.income);
}

export type FinanceBucket = { key: string; income: number; expense: number; net: number; playedSeconds: number; days: number };

/**
 * Totaux par jour (period courte) ou par mois (« AAAA-MM »), du plus ancien au plus récent, de
 * `from` (ou du premier jour connu) jusqu'à `today`. Les jours et mois sans activité sont gardés :
 * une colonne vide dit qu'on n'a pas joué, pas qu'on ne sait pas.
 */
export function buckets(rows: readonly LedgerDayRow[], grouping: "day" | "month", from: string | null, today: string): FinanceBucket[] {
  const keyOf = (day: string) => (grouping === "day" ? day : day.slice(0, 7));
  const first = from ?? rows.map((row) => row.day).sort()[0] ?? today;
  const result = new Map<string, FinanceBucket>();
  for (let day = first; day <= today; day = grouping === "day" ? addDays(day, 1) : nextMonth(day)) {
    const key = keyOf(day);
    result.set(key, { key, income: 0, expense: 0, net: 0, playedSeconds: 0, days: 0 });
  }
  const daysSeen = new Map<string, Set<string>>();
  for (const row of rows) {
    const bucket = result.get(keyOf(row.day));
    if (!bucket) continue;
    bucket.income += sumOf(row.income);
    bucket.expense += sumOf(row.expense);
    bucket.playedSeconds += row.playedSeconds ?? 0;
    daysSeen.set(bucket.key, (daysSeen.get(bucket.key) ?? new Set()).add(row.day));
  }
  for (const bucket of result.values()) {
    bucket.net = bucket.income - bucket.expense;
    bucket.days = daysSeen.get(bucket.key)?.size ?? 0;
  }
  return [...result.values()];
}

/** Premier jour du mois suivant. */
function nextMonth(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}
