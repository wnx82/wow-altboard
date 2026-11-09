// Or cumulé de tous les personnages, jour par jour. Un relevé n'est créé qu'à une progression :
// entre deux relevés, chaque personnage garde sa dernière valeur connue. Un personnage n'entre dans
// le total qu'à partir de son premier relevé.

export const GOLD_HISTORY_DAYS = 90;

export type MoneySnapshot = { characterId: number; capturedAt: Date; moneyCopper: number | null };
export type GoldDay = { day: string; copper: number; characters: number };

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" });

/** Jour calendaire à Bruxelles, « AAAA-MM-JJ ». */
export const brusselsDay = (date: Date) => dayKey.format(date);

/** Jours de `from` à `to` inclus, au format « AAAA-MM-JJ ». */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let date = new Date(`${from}T12:00:00Z`); brusselsDay(date) <= to; date = new Date(date.getTime() + 24 * 3600 * 1000)) {
    days.push(brusselsDay(date));
  }
  return days;
}

/**
 * Total par jour, de `since` à `now`. Les relevés d'avant `since` donnent la valeur de départ.
 * Les jours qui précèdent tout relevé sont omis.
 */
export function buildGoldHistory(snapshots: MoneySnapshot[], since: Date, now: Date): GoldDay[] {
  const ordered = snapshots.filter((s) => s.moneyCopper !== null).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const last = new Map<number, number>();
  const days: GoldDay[] = [];
  let next = 0;
  for (const day of daysBetween(brusselsDay(since), brusselsDay(now))) {
    while (next < ordered.length && brusselsDay(ordered[next].capturedAt) <= day) {
      last.set(ordered[next].characterId, ordered[next].moneyCopper!);
      next++;
    }
    if (last.size === 0) continue;
    let copper = 0;
    for (const value of last.values()) copper += value;
    days.push({ day, copper, characters: last.size });
  }
  return days;
}
