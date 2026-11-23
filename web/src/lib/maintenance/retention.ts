import { and, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { purgeOldChecks } from "@/lib/checklists/store";
import { brusselsDay, PLAYER_TIME_ZONE } from "@/lib/wow/format";

// Durée de conservation des tables qui ne font que grossir. Seuls le journal des synchronisations
// et les calculs d'opportunités sont purgés : ils se refont ou ne servent qu'au diagnostic.
// L'historique des personnages (relevés, sessions, finances) et celui des prix ne sont jamais
// perdus : ils n'existent nulle part ailleurs. Seuls les relevés de chaque scan d'EZAuctioneer,
// plusieurs par jour, sont ramenés à un résumé par jour au-delà de 60 jours. Les relevés des
// serveurs de jeu et les sessions de connexion ont déjà leur purge (lib/status/store.ts,
// lib/auth/session.ts). Les coches des listes ne valent que pour leur période : gardées 30 jours.

/** Journal des synchronisations gardé 180 jours ; la dernière synchronisation de chaque PC reste. */
export const SYNC_RUNS_KEPT_DAYS = 180;
/** Calculs d'opportunités gardés par marché ; ceux d'un audit du jour restent. */
export const OPPORTUNITY_RUNS_KEPT = 30;
/** Relevés de scan gardés tels quels ; les jours plus anciens (heure de Bruxelles) sont résumés dans market_item_scan_days. */
export const SCAN_SAMPLES_KEPT_DAYS = 60;
/** Coches des listes à cocher : la plus longue période dure une semaine. */
export const CHECKLIST_CHECKS_KEPT_DAYS = 30;
/** Jours résumés au plus par passage : une requête par jour, chacune sous le délai du client. */
const SCAN_DAYS_PER_PRUNE = 400;

export type RetentionResult = { syncRuns: number; opportunityRuns: number; scanSamplesFolded: number; checklistChecks: number };

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

  const checklistChecks = await purgeOldChecks(db, brusselsDay(now.getTime() - CHECKLIST_CHECKS_KEPT_DAYS * 24 * 60 * 60_000));
  return { syncRuns: syncRuns.rowCount ?? 0, opportunityRuns, scanSamplesFolded: await foldOldScans(db, now), checklistChecks };
}

/** Fuseau des jours de résumé : celui des autres pages (Activité, Finances…). */
export const SCAN_DAY_TIME_ZONE = PLAYER_TIME_ZONE;

/**
 * Résume les relevés de scan des jours (heure de Bruxelles) antérieurs à la fenêtre gardée : plus
 * bas, médiane et plus haut des prix, plus grand nombre d'unités, nombre de scans ; puis les
 * supprime. Un jour par requête, déplacement et résumé dans la même. Un relevé arrivé plus tard
 * pour un jour déjà résumé (PC resté longtemps hors ligne) s'y ajoute : bornes et comptes exacts,
 * médiane de la partie la mieux relevée. Rend le nombre de relevés résumés.
 */
export async function foldOldScans(db: Database, now: Date): Promise<number> {
  const zone = SCAN_DAY_TIME_ZONE;
  // Minuit, heure de Bruxelles, il y a 60 jours : seuls des jours entiers sont résumés.
  const keptFrom = sql`((((${now}::timestamptz) at time zone ${zone})::date - ${SCAN_SAMPLES_KEPT_DAYS}::int)::timestamp at time zone ${zone})`;
  let folded = 0;
  for (let pass = 0; pass < SCAN_DAYS_PER_PRUNE; pass++) {
    const result = await db.execute<{ moved: number }>(sql`
      with oldest as (
        select (min(${t.marketItemScans.scannedAt}) at time zone ${zone})::date as day
        from ${t.marketItemScans}
        where ${t.marketItemScans.scannedAt} < ${keptFrom}
      ),
      bounds as (
        select (day::timestamp at time zone ${zone}) as low, least(((day + 1)::timestamp at time zone ${zone}), ${keptFrom}) as high
        from oldest
        where day is not null
      ),
      moved as (
        delete from ${t.marketItemScans}
        using bounds
        where ${t.marketItemScans.scannedAt} >= bounds.low and ${t.marketItemScans.scannedAt} < bounds.high
        returning scan_market_id, item_key, item_id, scanned_at, price_copper, units
      ),
      summarized as (
        insert into ${t.marketItemScanDays} (scan_market_id, item_key, item_id, day, low_copper, median_copper, high_copper, max_units, scans)
        select scan_market_id, item_key, min(item_id), (scanned_at at time zone ${zone})::date,
          min(price_copper), percentile_disc(0.5) within group (order by price_copper), max(price_copper), max(units), count(*)::int
        from moved
        -- Par position : le fuseau, passé en paramètre, ferait deux expressions distinctes.
        group by 1, 2, 4
        on conflict (scan_market_id, item_key, day) do update set
          low_copper = least(${t.marketItemScanDays.lowCopper}, excluded.low_copper),
          high_copper = greatest(${t.marketItemScanDays.highCopper}, excluded.high_copper),
          median_copper = case when excluded.scans > ${t.marketItemScanDays.scans} then excluded.median_copper else ${t.marketItemScanDays.medianCopper} end,
          max_units = greatest(${t.marketItemScanDays.maxUnits}, excluded.max_units),
          scans = ${t.marketItemScanDays.scans} + excluded.scans
        returning 1
      )
      select (select count(*) from moved)::int as moved
    `);
    const moved = Number(result.rows[0]?.moved ?? 0);
    if (moved === 0) break;
    folded += moved;
  }
  return folded;
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
