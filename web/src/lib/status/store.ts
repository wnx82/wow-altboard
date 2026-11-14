import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { serverStatusChecks } from "@/db/schema";
import type { CheckRecord } from "./monitor";

// Lectures et écritures des contrôles. La page lit son état ici, jamais dans la mémoire du
// moniteur : elle reste juste après un redémarrage.

export async function recordChecks(db: Database, checks: CheckRecord[]): Promise<void> {
  if (checks.length === 0) return;
  await db.insert(serverStatusChecks).values(checks);
}

/** Supprime les contrôles antérieurs à `before`. Renvoie le nombre de lignes supprimées. */
export async function pruneChecks(db: Database, before: Date): Promise<number> {
  const result = await db.delete(serverStatusChecks).where(lt(serverStatusChecks.checkedAt, before));
  return result.rowCount ?? 0;
}

const CHECK_COLUMNS = {
  service: serverStatusChecks.service,
  checkedAt: serverStatusChecks.checkedAt,
  status: serverStatusChecks.status,
  outcome: serverStatusChecks.outcome,
  latencyMs: serverStatusChecks.latencyMs,
  targetsUp: serverStatusChecks.targetsUp,
  targetsTotal: serverStatusChecks.targetsTotal,
  error: serverStatusChecks.error,
};

export type CheckRow = {
  service: string;
  checkedAt: Date;
  status: string;
  outcome: string;
  latencyMs: number | null;
  targetsUp: number;
  targetsTotal: number;
  error: string | null;
};

/** Services surveillés, dans l'ordre d'affichage (contrainte server_status_checks_service_check). */
const SERVICES = ["auth", "game"] as const;

/**
 * Dernière ligne de chaque service, une lecture par service servie par l'index (service,
 * checked_at) : un DISTINCT ON parcourait toute la table pour rendre deux lignes, à chaque
 * ouverture de l'accueil.
 */
async function lastPerService(db: Database, answeredOnly: boolean): Promise<CheckRow[]> {
  const rows = await Promise.all(
    SERVICES.map((service) =>
      db
        .select(CHECK_COLUMNS)
        .from(serverStatusChecks)
        .where(
          answeredOnly
            ? and(eq(serverStatusChecks.service, service), inArray(serverStatusChecks.status, ["up", "degraded"]))
            : eq(serverStatusChecks.service, service),
        )
        .orderBy(desc(serverStatusChecks.checkedAt))
        .limit(1),
    ),
  );
  return rows.flat();
}

/** Dernier contrôle de chaque service. */
export function latestChecks(db: Database): Promise<CheckRow[]> {
  return lastPerService(db, false);
}

/** Dernier contrôle de chaque service où il a répondu : la dernière mesure valide. */
export function lastAnswers(db: Database): Promise<CheckRow[]> {
  return lastPerService(db, true);
}

export type HourBucket = {
  service: string;
  hour: Date;
  availableSeconds: number;
  degradedSeconds: number;
  downSeconds: number;
};

/**
 * Durées par service et par heure (UTC). Chaque contrôle vaut jusqu'au suivant, au plus
 * `capMs` : au-delà, c'est une période sans mesure. Les contrôles « inconnu » ne comptent ni
 * comme disponibilité ni comme panne. Pondérer par la durée, pas par le nombre de contrôles,
 * évite de sous-compter une panne pendant laquelle les contrôles s'espacent.
 */
export async function hourlyBuckets(db: Database, since: Date, now: Date, capMs: number): Promise<HourBucket[]> {
  const result = await db.execute<{ service: string; hour: Date; available_seconds: number; degraded_seconds: number; down_seconds: number }>(sql`
    with spans as (
      select
        service,
        status,
        checked_at,
        least(
          extract(epoch from coalesce(lead(checked_at) over (partition by service order by checked_at), ${now.toISOString()}::timestamptz) - checked_at),
          ${capMs / 1000}::float8
        ) as seconds
      from ${serverStatusChecks}
      where checked_at >= ${since.toISOString()}::timestamptz
    )
    select
      service,
      date_trunc('hour', checked_at, 'UTC') as hour,
      coalesce(sum(seconds) filter (where status in ('up', 'degraded')), 0)::float8 as available_seconds,
      coalesce(sum(seconds) filter (where status = 'degraded'), 0)::float8 as degraded_seconds,
      coalesce(sum(seconds) filter (where status = 'down'), 0)::float8 as down_seconds
    from spans
    group by service, date_trunc('hour', checked_at, 'UTC')
    order by service, hour
  `);
  return result.rows.map((row) => ({
    service: row.service,
    hour: new Date(row.hour),
    availableSeconds: Math.max(0, row.available_seconds),
    degradedSeconds: Math.max(0, row.degraded_seconds),
    downSeconds: Math.max(0, row.down_seconds),
  }));
}

export type TransitionRow = CheckRow & { previous: string };

/** Changements de statut depuis `since`, du plus récent au plus ancien. */
export async function listTransitions(db: Database, since: Date, limit: number): Promise<TransitionRow[]> {
  const result = await db.execute<{
    service: string;
    checked_at: Date;
    status: string;
    outcome: string;
    latency_ms: number | null;
    targets_up: number;
    targets_total: number;
    error: string | null;
    previous: string;
  }>(sql`
    select service, checked_at, status, outcome, latency_ms, targets_up, targets_total, error, previous
    from (
      select
        service, checked_at, status, outcome, latency_ms, targets_up, targets_total, error,
        lag(status) over (partition by service order by checked_at) as previous
      from ${serverStatusChecks}
      where checked_at >= ${since.toISOString()}::timestamptz
    ) changes
    where previous is not null and previous <> status
    order by checked_at desc, service
    limit ${limit}
  `);
  return result.rows.map((row) => ({
    service: row.service,
    checkedAt: new Date(row.checked_at),
    status: row.status,
    outcome: row.outcome,
    latencyMs: row.latency_ms,
    targetsUp: row.targets_up,
    targetsTotal: row.targets_total,
    error: row.error,
    previous: row.previous,
  }));
}
