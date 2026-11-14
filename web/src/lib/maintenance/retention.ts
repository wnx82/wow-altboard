import { and, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";

// Durée de conservation des tables qui ne font que grossir. Seuls le journal des synchronisations
// et les calculs d'opportunités sont purgés : ils se refont ou ne servent qu'au diagnostic.
// L'historique des personnages (relevés, sessions, finances) et celui des prix ne sont jamais
// touchés : ils n'existent nulle part ailleurs. Les relevés des serveurs de jeu et les sessions de
// connexion ont déjà leur purge (lib/status/store.ts, lib/auth/session.ts).

/** Journal des synchronisations gardé 180 jours ; la dernière synchronisation de chaque PC reste. */
export const SYNC_RUNS_KEPT_DAYS = 180;
/** Calculs d'opportunités gardés par marché ; ceux d'un audit du jour restent. */
export const OPPORTUNITY_RUNS_KEPT = 30;

export type RetentionResult = { syncRuns: number; opportunityRuns: number };

export async function pruneHistory(db: Database, now: Date): Promise<RetentionResult> {
  const before = new Date(now.getTime() - SYNC_RUNS_KEPT_DAYS * 24 * 60 * 60_000);

  // Dernière synchronisation de chaque PC, et la dernière réussie : l'accueil et Machines les affichent.
  const kept = await db.execute<{ id: number }>(sql`
    select max(id)::bigint as id from ${t.syncRuns} group by ${t.syncRuns.machineId}
    union
    select max(id)::bigint as id from ${t.syncRuns} where ${t.syncRuns.status} = 'success' group by ${t.syncRuns.machineId}
  `);
  const keptRuns = kept.rows.map((row) => Number(row.id));
  // Les erreurs suivent (cascade) ; relevés et imports de prix gardent leur ligne, sans le lien.
  const syncRuns = await db
    .delete(t.syncRuns)
    .where(keptRuns.length > 0 ? and(lt(t.syncRuns.startedAt, before), notInArray(t.syncRuns.id, keptRuns)) : lt(t.syncRuns.startedAt, before));

  // Calculs au-delà des 30 plus récents de leur marché, hors ceux qu'un audit du jour cite.
  const stale = await db.execute<{ id: number }>(sql`
    select id from (
      select ${t.opportunityRuns.id} as id, row_number() over (partition by ${t.opportunityRuns.marketId} order by ${t.opportunityRuns.id} desc) as position
      from ${t.opportunityRuns}
    ) ranked
    where position > ${OPPORTUNITY_RUNS_KEPT}
      and id not in (select ${t.economyAudits.runId} from ${t.economyAudits} where ${t.economyAudits.runId} is not null)
  `);
  const staleRuns = stale.rows.map((row) => Number(row.id));
  // Les opportunités de ces calculs suivent (cascade).
  const opportunityRuns = staleRuns.length > 0 ? ((await db.delete(t.opportunityRuns).where(inArray(t.opportunityRuns.id, staleRuns))).rowCount ?? 0) : 0;

  return { syncRuns: syncRuns.rowCount ?? 0, opportunityRuns };
}

/** Premier passage dix minutes après le démarrage, puis chaque jour. */
export const FIRST_PRUNE_MS = 10 * 60_000;
export const PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

type Holder = { timer: ReturnType<typeof setTimeout> | null };
type GlobalWithRetention = typeof globalThis & { __wowAltboardRetention?: Holder };

/** Purge quotidienne, consignée dans le journal du serveur ; un second appel ne programme rien de plus. */
export function startRetentionRuntime(database: () => Database): void {
  // Sur globalThis : instrumentation.ts et les pages ne partagent pas l'état d'un module.
  const global = globalThis as GlobalWithRetention;
  const held = (global.__wowAltboardRetention ??= { timer: null });
  if (held.timer) return;
  const schedule = (delay: number) => {
    held.timer = setTimeout(() => {
      const started = Date.now();
      void pruneHistory(database(), new Date())
        .then((result) => console.log(JSON.stringify({ event: "retention.prune", ok: true, ms: Date.now() - started, ...result })))
        .catch((error: unknown) =>
          console.error(JSON.stringify({ event: "retention.prune", ok: false, error: error instanceof Error ? error.name : "unknown" })),
        );
      schedule(PRUNE_INTERVAL_MS);
    }, delay);
    // Le minuteur ne retient pas le processus.
    held.timer.unref?.();
  };
  schedule(FIRST_PRUNE_MS);
}
