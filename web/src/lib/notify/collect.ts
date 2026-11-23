import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { weekOf } from "@/lib/dashboard/playtime";
import { machineLabel } from "@/lib/dashboard/queries";
import { listAlerts, noticeAlerts, type AlertStatus } from "@/lib/economy/alerts";
import { addDays } from "@/lib/economy/days";
import { loadItemNames } from "@/lib/economy/item-names";
import { itemLabel, listMarkets } from "@/lib/economy/load";
import { itemHref } from "@/lib/economy/view";
import { PLAYER_TIME_ZONE } from "@/lib/wow/format";
import type { NotifyEventKey, NotifySettings } from "./config";
import { goalEvent, levelEvent, priceEvent, serverEvent, silentEvent, silentMachines, weeklyEvent, type NotificationEvent, type WeeklyFacts } from "./events";

// Ce qui s'est passé depuis le dernier passage : niveaux gagnés, objectifs atteints, serveur de jeu
// revenu, PC muets, alertes de prix franchies, rapport de la semaine écoulée. L'état
// (notification_state, price_alerts.notified_at) avance à chaque passage, que l'événement soit
// envoyé ou non : activer un événement plus tard n'annonce pas le passé. Au premier passage,
// l'état prend les valeurs du moment et rien n'est annoncé.

/** Relevés examinés par passage, au plus ; le reste attend le passage suivant. */
export const SNAPSHOTS_PER_PASS = 500;
/** Contrôles « hors ligne » consécutifs avant qu'un retour soit annoncé : une coupure brève ne l'est pas. */
export const MIN_DOWN_CHECKS = 2;
/** Heure (Bruxelles) à partir de laquelle le rapport de la semaine écoulée part, le lundi. */
export const WEEKLY_REPORT_HOUR = 9;

const HOUR = 3600 * 1000;
const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: PLAYER_TIME_ZONE, hour: "2-digit", hourCycle: "h23" });

/** Minuit à Bruxelles du jour donné (AAAA-MM-JJ), en instant. */
export function brusselsMidnight(day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  // À minuit UTC, Bruxelles affiche 1 h ou 2 h : c'est son avance sur UTC ce jour-là.
  return new Date(utcMidnight.getTime() - Number(hourFormat.format(utcMidnight)) * HOUR);
}

type State = typeof t.notificationState.$inferSelect;

export async function collectEvents(db: Database, settings: NotifySettings, wanted: ReadonlySet<NotifyEventKey>, now: Date): Promise<NotificationEvent[]> {
  // Statuts lus hors de la transaction (moteur de prix, cache) ; l'annonce, elle, y est décidée.
  const alerts = await listAlerts(db, { now });
  const crossed = await db.transaction(async (tx) => {
    const [state] = await tx.select().from(t.notificationState).where(eq(t.notificationState.id, 1)).for("update");
    if (!state) {
      await initialize(tx, settings, now);
      // Les seuils déjà franchis sont tenus pour connus, comme le reste.
      await noticeAlerts(tx, alerts, now);
      return null;
    }

    const events: NotificationEvent[] = [];
    const levels = await levelEvents(tx, state.lastSnapshotId);
    if (wanted.has("level")) events.push(...levels.events);

    // Toujours datées, même sans webhook : sinon une activation ultérieure annoncerait le passé.
    const goals = await tx
      .update(t.characterGoals)
      .set({ notifiedAt: now })
      .where(and(isNotNull(t.characterGoals.achievedAt), isNull(t.characterGoals.notifiedAt)))
      .returning({ id: t.characterGoals.id, label: t.characterGoals.label, achievedAt: t.characterGoals.achievedAt, characterId: t.characterGoals.characterId });
    if (wanted.has("goal") && goals.length > 0) {
      const names = await tx
        .select({ id: t.characters.id, name: t.characters.name })
        .from(t.characters)
        .where(
          inArray(
            t.characters.id,
            goals.map((goal) => goal.characterId),
          ),
        );
      for (const goal of goals.sort((a, b) => a.achievedAt!.getTime() - b.achievedAt!.getTime() || a.id - b.id)) {
        const character = names.find((row) => row.id === goal.characterId);
        if (character) events.push(goalEvent({ id: goal.id, label: goal.label, achievedAt: goal.achievedAt! }, character));
      }
    }

    const server = await serverEvents(tx, state.lastCheckId);
    if (wanted.has("server")) events.push(...server.events);

    const machines = await tx.select({ id: t.machines.id, displayName: t.machines.displayName, hostname: t.machines.hostname, lastSeenAt: t.machines.lastSeenAt }).from(t.machines);
    const silence = silentMachines(
      machines.map((machine) => ({ id: machine.id, label: machineLabel(machine), lastSeenAt: machine.lastSeenAt })),
      state.silentMachines,
      settings.silentDays,
      now,
    );
    if (wanted.has("silent")) events.push(...silence.silent.map((machine) => silentEvent(machine, machine.days)));

    // Toujours retenues, même sans webhook : un seuil franchi avant l'activation n'est pas annoncé.
    const prices = await noticeAlerts(tx, alerts, now);

    const weekly = await weeklyReport(tx, state, wanted.has("weekly"), now);
    if (weekly.event) events.push(weekly.event);

    await tx
      .update(t.notificationState)
      .set({ lastSnapshotId: levels.cursor, lastCheckId: server.cursor, silentMachines: silence.notified, lastWeeklyReport: weekly.week, updatedAt: now })
      .where(eq(t.notificationState.id, 1));
    return { events, prices: wanted.has("price") ? prices : [] };
  });
  if (crossed === null) return [];
  // Le rapport de la semaine reste le dernier envoyé.
  const priceEvents = await priceAlertEvents(db, crossed.prices);
  const weekly = crossed.events.findIndex((event) => event.key === "weekly");
  return weekly === -1 ? [...crossed.events, ...priceEvents] : [...crossed.events.slice(0, weekly), ...priceEvents, ...crossed.events.slice(weekly)];
}

/** Événements des alertes franchies : nom de l'objet, du marché, et lien vers la page de l'objet. */
async function priceAlertEvents(db: Database, alerts: readonly AlertStatus[]): Promise<NotificationEvent[]> {
  if (alerts.length === 0) return [];
  const [names, markets] = await Promise.all([loadItemNames(db, alerts.map((alert) => alert.itemKey)), listMarkets(db)]);
  const origin = (process.env.WOW_APP_ORIGIN ?? "").replace(/\/$/, "");
  return alerts
    .filter((alert) => alert.latest !== null)
    .map((alert) =>
      priceEvent({
        alertId: alert.id,
        marketId: alert.marketId,
        market: markets.find((market) => market.id === alert.marketId)?.label ?? `marché ${alert.marketId}`,
        itemKey: alert.itemKey,
        item: itemLabel(names, alert.itemKey),
        direction: alert.direction,
        thresholdCopper: alert.thresholdCopper,
        priceCopper: alert.latest!.minCopper,
        day: alert.latest!.day,
        observedAt: alert.latest!.at ?? null,
        source: alert.latest!.source ?? "auctionator",
        url: origin ? `${origin}${process.env.WOW_BASE_PATH ?? ""}${itemHref(alert.itemKey, `?market=${alert.marketId}`)}` : null,
      }),
    );
}

async function initialize(tx: DatabaseOrTransaction, settings: NotifySettings, now: Date): Promise<void> {
  const [snapshots] = await tx.select({ max: sql<string | null>`max(${t.characterSnapshots.id})` }).from(t.characterSnapshots);
  const [checks] = await tx.select({ max: sql<string | null>`max(${t.serverStatusChecks.id})` }).from(t.serverStatusChecks);
  const machines = await tx.select({ id: t.machines.id, lastSeenAt: t.machines.lastSeenAt }).from(t.machines);
  // Les PC déjà muets sont tenus pour signalés : seul un nouveau silence le sera.
  const { notified } = silentMachines(
    machines.map((machine) => ({ ...machine, label: "" })),
    {},
    settings.silentDays,
    now,
  );
  await tx.update(t.characterGoals).set({ notifiedAt: now }).where(and(isNotNull(t.characterGoals.achievedAt), isNull(t.characterGoals.notifiedAt)));
  await tx
    .insert(t.notificationState)
    .values({ id: 1, lastSnapshotId: Number(snapshots.max ?? 0), lastCheckId: Number(checks.max ?? 0), silentMachines: notified, lastWeeklyReport: weekOf(now), updatedAt: now })
    .onConflictDoNothing();
  console.log(JSON.stringify({ event: "notify.initialized" }));
}

/** Niveaux gagnés depuis le relevé `cursor` : un événement par personnage, du premier niveau au dernier. */
async function levelEvents(tx: DatabaseOrTransaction, cursor: number): Promise<{ events: NotificationEvent[]; cursor: number }> {
  const rows = await tx.execute<{ id: string; character_id: string; name: string; level: number | null; previous: number | null }>(sql`
    select s.id, s.character_id, c.name, s.level, prev.level as previous
    from ${t.characterSnapshots} s
    join ${t.characters} c on c.id = s.character_id
    left join lateral (
      select p.level from ${t.characterSnapshots} p
      where p.character_id = s.character_id and p.captured_at < s.captured_at and p.level is not null
      order by p.captured_at desc limit 1
    ) prev on true
    where s.id > ${cursor}
    order by s.id
    limit ${SNAPSHOTS_PER_PASS}`);
  const gained = new Map<number, { name: string; from: number; to: number }>();
  for (const row of rows.rows) {
    if (row.level === null || row.previous === null || row.level <= row.previous) continue;
    const id = Number(row.character_id);
    const known = gained.get(id);
    gained.set(id, { name: row.name, from: Math.min(known?.from ?? row.previous, row.previous), to: Math.max(known?.to ?? row.level, row.level) });
  }
  return {
    events: [...gained].map(([id, entry]) => levelEvent({ id, name: entry.name }, entry.from, entry.to)),
    cursor: rows.rows.length === 0 ? cursor : Number(rows.rows.at(-1)!.id),
  };
}

/**
 * Retours du serveur de jeu depuis le contrôle `cursor` : un contrôle qui répond après au moins
 * MIN_DOWN_CHECKS contrôles hors ligne. Les contrôles « inconnu » ne comptent ni pour ni contre.
 */
async function serverEvents(tx: DatabaseOrTransaction, cursor: number): Promise<{ events: NotificationEvent[]; cursor: number }> {
  const game = eq(t.serverStatusChecks.service, "game");
  const known = sql`${t.serverStatusChecks.status} <> 'unknown'`;
  const columns = { id: t.serverStatusChecks.id, checkedAt: t.serverStatusChecks.checkedAt, status: t.serverStatusChecks.status, latencyMs: t.serverStatusChecks.latencyMs };
  const [recent, [last]] = await Promise.all([
    tx.select(columns).from(t.serverStatusChecks).where(and(gt(t.serverStatusChecks.id, cursor), game, known)).orderBy(asc(t.serverStatusChecks.id)).limit(1_000),
    tx.select({ max: sql<string | null>`max(${t.serverStatusChecks.id})` }).from(t.serverStatusChecks),
  ]);
  // Coupure déjà commencée au dernier passage : ses contrôles précédents, du plus récent au plus ancien.
  const before = await tx
    .select(columns)
    .from(t.serverStatusChecks)
    .where(and(lte(t.serverStatusChecks.id, cursor), game, known))
    .orderBy(sql`${t.serverStatusChecks.id} desc`)
    .limit(50);
  let down: { count: number; since: Date | null } = { count: 0, since: null };
  for (const check of before) {
    if (check.status !== "down") break;
    down = { count: down.count + 1, since: check.checkedAt };
  }

  const events: NotificationEvent[] = [];
  for (const check of recent) {
    if (check.status === "down") {
      down = { count: down.count + 1, since: down.since ?? check.checkedAt };
      continue;
    }
    if (down.count >= MIN_DOWN_CHECKS && down.since) events.push(serverEvent(check, down.since));
    down = { count: 0, since: null };
  }
  const max = Number(last?.max ?? cursor);
  // Plus de mille contrôles en attente : le curseur s'arrête au dernier lu.
  return { events, cursor: recent.length === 1_000 ? recent.at(-1)!.id : Math.max(cursor, max) };
}

/**
 * Rapport de la semaine écoulée, une fois par semaine, à partir du lundi WEEKLY_REPORT_HOUR h.
 * `week` : lundi de la semaine en cours une fois le rapport traité, envoyé ou non.
 */
async function weeklyReport(tx: DatabaseOrTransaction, state: State, wanted: boolean, now: Date): Promise<{ event: NotificationEvent | null; week: string | null }> {
  const monday = weekOf(now);
  if (state.lastWeeklyReport === monday) return { event: null, week: monday };
  const end = brusselsMidnight(monday);
  if (now.getTime() < end.getTime() + WEEKLY_REPORT_HOUR * HOUR) return { event: null, week: state.lastWeeklyReport };
  if (!wanted) return { event: null, week: monday };
  const previous = addDays(monday, -7);
  const facts = await weeklyFacts(tx, previous, brusselsMidnight(previous), end);
  return { event: weeklyEvent(facts), week: monday };
}

export async function weeklyFacts(tx: DatabaseOrTransaction, week: string, start: Date, end: Date): Promise<WeeklyFacts> {
  const [levels, gold, sessions, goals] = await Promise.all([
    tx.execute<{ name: string; from_level: number | null; to_level: number }>(sql`
      with last_end as (
        select distinct on (character_id) character_id, level from ${t.characterSnapshots}
        where captured_at < ${end.toISOString()}::timestamptz and level is not null order by character_id, captured_at desc
      ), last_start as (
        select distinct on (character_id) character_id, level from ${t.characterSnapshots}
        where captured_at < ${start.toISOString()}::timestamptz and level is not null order by character_id, captured_at desc
      ), first_in as (
        select distinct on (character_id) character_id, level from ${t.characterSnapshots}
        where captured_at >= ${start.toISOString()}::timestamptz and captured_at < ${end.toISOString()}::timestamptz and level is not null
        order by character_id, captured_at asc
      )
      select c.name, coalesce(last_start.level, first_in.level) as from_level, last_end.level as to_level
      from last_end
      join ${t.characters} c on c.id = last_end.character_id
      left join last_start on last_start.character_id = last_end.character_id
      left join first_in on first_in.character_id = last_end.character_id
      order by c.name`),
    tx.execute<{ gold_start: string | null; gold_end: string | null }>(sql`
      select
        (select sum(money_copper) from (select distinct on (character_id) money_copper from ${t.characterSnapshots}
          where captured_at < ${start.toISOString()}::timestamptz and money_copper is not null order by character_id, captured_at desc) s)::text as gold_start,
        (select sum(money_copper) from (select distinct on (character_id) money_copper from ${t.characterSnapshots}
          where captured_at < ${end.toISOString()}::timestamptz and money_copper is not null order by character_id, captured_at desc) e)::text as gold_end`),
    tx
      .select({ seconds: sql<string | null>`sum(${t.characterSessions.durationSeconds})::text`, count: sql<number>`count(*)::int` })
      .from(t.characterSessions)
      .where(sql`${t.characterSessions.startedAt} >= ${start.toISOString()}::timestamptz and ${t.characterSessions.startedAt} < ${end.toISOString()}::timestamptz`),
    tx
      .select({ character: t.characters.name, label: t.characterGoals.label })
      .from(t.characterGoals)
      .innerJoin(t.characters, eq(t.characters.id, t.characterGoals.characterId))
      .where(sql`${t.characterGoals.achievedAt} >= ${start.toISOString()}::timestamptz and ${t.characterGoals.achievedAt} < ${end.toISOString()}::timestamptz`)
      .orderBy(asc(t.characterGoals.achievedAt)),
  ]);
  return {
    week,
    levels: levels.rows
      .filter((row) => row.from_level !== null && row.to_level > row.from_level)
      .map((row) => ({ name: row.name, from: Number(row.from_level), to: Number(row.to_level) })),
    goldStart: Number(gold.rows[0]?.gold_start ?? 0),
    goldEnd: Number(gold.rows[0]?.gold_end ?? 0),
    playedSeconds: Number(sessions[0]?.seconds ?? 0),
    sessions: sessions[0]?.count ?? 0,
    goals,
  };
}

