import { brusselsDay } from "./gold-history";

// Temps de jeu de tous les personnages, à partir des données d'Allemano Ledger : /played par
// compte, résumé par semaine et répartition par jour et par heure. Pur, sans base.

/** Semaines résumées et couvertes par la carte jour × heure. */
export const PLAYTIME_WEEKS = 12;

export type PlaytimeRow = { characterId: number; accountId: number; accountLabel: string; totalSeconds: number | null };
export type SessionFact = { characterId: number; startedAt: Date; durationSeconds: number | null; xpGained: number | null; levels: number | null; tag: string | null };

export type AccountPlaytime = { accountId: number; label: string; seconds: number; characters: number; unmeasured: number };
export type WeekSummary = { week: string; seconds: number; xp: number; levels: number; sessions: number; byTag: Map<string | null, number> };

const HOUR = 3600 * 1000;
const weekdayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Brussels", weekday: "short" });
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", hourCycle: "h23" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Jour de la semaine à Bruxelles, lundi = 0. */
export const brusselsWeekday = (date: Date) => WEEKDAYS.indexOf(weekdayFormat.format(date));
const brusselsHour = (date: Date) => Number(hourFormat.format(date));

/** Lundi de la semaine de `date`, à Bruxelles, « AAAA-MM-JJ ». */
export function weekOf(date: Date): string {
  const day = new Date(`${brusselsDay(date)}T12:00:00Z`);
  return brusselsDay(new Date(day.getTime() - brusselsWeekday(date) * 24 * HOUR));
}

/** Dernier /played connu, additionné par compte ; le compte au plus gros temps d'abord. */
export function playtimeByAccount(rows: PlaytimeRow[]): AccountPlaytime[] {
  const accounts = new Map<number, AccountPlaytime>();
  for (const row of rows) {
    let account = accounts.get(row.accountId);
    if (!account) {
      account = { accountId: row.accountId, label: row.accountLabel, seconds: 0, characters: 0, unmeasured: 0 };
      accounts.set(row.accountId, account);
    }
    account.characters++;
    if (row.totalSeconds === null) account.unmeasured++;
    else account.seconds += row.totalSeconds;
  }
  return [...accounts.values()].sort((a, b) => b.seconds - a.seconds);
}

/**
 * Les `weeks` dernières semaines, de la plus récente à la plus ancienne. Les semaines vides sont
 * gardées entre deux semaines jouées ; celles d'avant la première session ne le sont pas, sauf la
 * semaine en cours, toujours présente.
 */
export function weeklySummary(sessions: SessionFact[], now: Date, weeks = PLAYTIME_WEEKS): WeekSummary[] {
  const summaries = new Map<string, WeekSummary>();
  let monday = weekOf(now);
  for (let index = 0; index < weeks; index++) {
    summaries.set(monday, { week: monday, seconds: 0, xp: 0, levels: 0, sessions: 0, byTag: new Map() });
    monday = brusselsDay(new Date(new Date(`${monday}T12:00:00Z`).getTime() - 7 * 24 * HOUR));
  }
  for (const session of sessions) {
    const summary = summaries.get(weekOf(session.startedAt));
    if (!summary) continue;
    const seconds = session.durationSeconds ?? 0;
    summary.sessions++;
    summary.seconds += seconds;
    summary.xp += session.xpGained ?? 0;
    summary.levels += session.levels ?? 0;
    summary.byTag.set(session.tag, (summary.byTag.get(session.tag) ?? 0) + seconds);
  }
  const ordered = [...summaries.values()];
  while (ordered.length > 1 && ordered.at(-1)!.sessions === 0) ordered.pop();
  return ordered;
}

/**
 * Secondes jouées par jour de la semaine (lundi = 0) et par heure, à Bruxelles, depuis `since`.
 * Le temps connecté d'une session est réparti d'un seul tenant à partir de son début : les pauses
 * ne sont pas datées par l'addon.
 */
export function hourlyHeatmap(sessions: SessionFact[], since: Date): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const session of sessions) {
    if (session.startedAt < since || !session.durationSeconds) continue;
    let cursor = session.startedAt.getTime();
    const end = cursor + session.durationSeconds * 1000;
    while (cursor < end) {
      // Bruxelles est décalée d'heures entières : les heures locales commencent avec les heures UTC.
      const nextHour = Math.min(end, Math.floor(cursor / HOUR) * HOUR + HOUR);
      const at = new Date(cursor);
      grid[brusselsWeekday(at)][brusselsHour(at)] += (nextHour - cursor) / 1000;
      cursor = nextHour;
    }
  }
  return grid;
}
