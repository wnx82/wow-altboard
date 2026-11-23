import { PLAYER_TIME_ZONE } from "@/lib/wow/format";

// Périodes des listes à cocher : une tâche quotidienne se refait après chaque réinitialisation du
// jour, une hebdomadaire après celle de la semaine. Heures de Bruxelles, heure d'été comprise.

export type ChecklistPeriod = "daily" | "weekly";
export const CHECKLIST_PERIODS: readonly ChecklistPeriod[] = ["daily", "weekly"];
export const PERIOD_LABELS: Record<ChecklistPeriod, string> = { daily: "Chaque jour", weekly: "Chaque semaine" };

/** Heure de la réinitialisation (0 à 23) et jour de celle de la semaine (1 lundi à 7 dimanche). */
export type ResetRule = { hour: number; weekday: number };
export const DEFAULT_RESET: ResetRule = { hour: 5, weekday: 3 };
export const WEEKDAY_LABELS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

export const isChecklistPeriod = (value: unknown): value is ChecklistPeriod => value === "daily" || value === "weekly";

export function resetRule(settings: { resetHour: number | null; resetWeekday: number | null }): ResetRule {
  return { hour: settings.resetHour ?? DEFAULT_RESET.hour, weekday: settings.resetWeekday ?? DEFAULT_RESET.weekday };
}

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLAYER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Date et heure de Bruxelles d'un instant. */
function local(instant: Date) {
  const value = Object.fromEntries(parts.formatToParts(instant).map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second) };
}

/** Jour civil décalé de `days` jours, en AAAA-MM-JJ. */
function shiftDay(year: number, month: number, day: number, days: number): string {
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Jour de la semaine (1 lundi à 7 dimanche) d'un jour civil. */
function weekdayOf(year: number, month: number, day: number): number {
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

/** Jour de Bruxelles (AAAA-MM-JJ) où a commencé la période en cours. */
export function periodStart(period: ChecklistPeriod, now: Date, rule: ResetRule): string {
  const { year, month, day, hour } = local(now);
  const beforeReset = hour < rule.hour;
  if (period === "daily") return shiftDay(year, month, day, beforeReset ? -1 : 0);
  let back = (weekdayOf(year, month, day) - rule.weekday + 7) % 7;
  if (back === 0 && beforeReset) back = 7;
  return shiftDay(year, month, day, -back);
}

/** Instant où il est `hour` heures à Bruxelles le jour `dayIso`. */
export function brusselsInstant(dayIso: string, hour: number): Date {
  const [year, month, day] = dayIso.split("-").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour);
  let instant = wanted;
  // Deux passes : le décalage peut changer entre l'estimation et le résultat (passage à l'heure d'été).
  for (let pass = 0; pass < 2; pass++) {
    const seen = local(new Date(instant));
    const shown = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    instant += wanted - shown;
  }
  return new Date(instant);
}

const weekdayName = new Intl.DateTimeFormat("fr-BE", { weekday: "long", timeZone: PLAYER_TIME_ZONE });
const dayName = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long", timeZone: PLAYER_TIME_ZONE });

/** « aujourd'hui à 5 h », « demain à 5 h », « mercredi à 5 h » (dans la semaine), sinon la date. */
export function formatReset(at: Date, now: Date): string {
  const { year, month, day } = local(now);
  const target = local(at);
  const days = Math.round((Date.UTC(target.year, target.month - 1, target.day) - Date.UTC(year, month - 1, day)) / 86_400_000);
  const when = days === 0 ? "aujourd'hui" : days === 1 ? "demain" : days < 7 ? weekdayName.format(at) : dayName.format(at);
  return `${when} à ${target.hour} h`;
}

/** Règle en clair : « chaque jour à 5 h, chaque semaine le mercredi ». */
export function describeRule(rule: ResetRule): string {
  return `chaque jour à ${rule.hour} h, chaque semaine le ${WEEKDAY_LABELS[rule.weekday - 1]}`;
}

/** Prochaine réinitialisation de la période. */
export function nextReset(period: ChecklistPeriod, now: Date, rule: ResetRule): Date {
  const [year, month, day] = periodStart(period, now, rule).split("-").map(Number);
  return brusselsInstant(shiftDay(year, month, day, period === "daily" ? 1 : 7), rule.hour);
}
