import { sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { chunks, fromUnix, uniqueBy } from "./helpers";
import type { CharacterPayload } from "./schema";

// Données de l'addon Allemano Ledger : finances par jour, temps de jeu par niveau et sessions.

const BATCH = 1_000;

/** Machine qui envoie le document et instant de réception. */
type LedgerScope = { machineId: number; now: Date };

/** Données de l'addon Allemano Ledger : appliquées même quand le fichier AltBoard est en retard. */
export async function applyLedger(tx: DatabaseOrTransaction, characterId: number, character: CharacterPayload, scope: LedgerScope): Promise<void> {
  await applyPlaytime(tx, characterId, character);
  await applySessions(tx, characterId, character);
  await applyFinances(tx, characterId, character, scope);
}

/**
 * Finances par jour (Allemano Ledger), rangées par machine : chaque PC ne compte que les sessions
 * jouées chez lui, et le fichier d'un PC fait foi pour ses propres journées. Un jour disparu du
 * fichier (l'addon en garde 800) reste en base.
 */
async function applyFinances(tx: DatabaseOrTransaction, characterId: number, character: CharacterPayload, scope: LedgerScope): Promise<void> {
  const days = uniqueBy(character.finances ?? [], (entry) => entry.day);
  const stored = t.characterLedgerDays;
  for (const batch of chunks(days, BATCH)) {
    await tx
      .insert(stored)
      .values(
        batch.map((entry) => ({
          characterId,
          machineId: scope.machineId,
          day: entry.day,
          income: positiveAmounts(entry.income),
          expense: positiveAmounts(entry.expense),
          transferIn: entry.transferIn,
          transferOut: entry.transferOut,
          lootValue: entry.lootValue ?? null,
          gold: entry.gold ?? null,
          playedSeconds: entry.playedSeconds ?? null,
          updatedAt: scope.now,
        })),
      )
      .onConflictDoUpdate({
        target: [stored.characterId, stored.machineId, stored.day],
        set: {
          income: sql`excluded.income`,
          expense: sql`excluded.expense`,
          transferIn: sql`excluded.transfer_in`,
          transferOut: sql`excluded.transfer_out`,
          lootValue: sql`excluded.loot_value`,
          gold: sql`excluded.gold`,
          playedSeconds: sql`excluded.played_seconds`,
          updatedAt: sql`excluded.updated_at`,
        },
        // Une journée inchangée n'est pas réécrite.
        setWhere: sql`(${stored.income}, ${stored.expense}, ${stored.transferIn}, ${stored.transferOut}, ${stored.lootValue}, ${stored.gold}, ${stored.playedSeconds})
          is distinct from (excluded.income, excluded.expense, excluded.transfer_in, excluded.transfer_out, excluded.loot_value, excluded.gold, excluded.played_seconds)`,
      });
  }
}

/** Montants par source, sans les sources nulles, dans un ordre stable. */
function positiveAmounts(amounts: Record<string, number | undefined>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(amounts)
      .filter((entry): entry is [string, number] => entry[1] !== undefined && entry[1] > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * Temps de jeu (Allemano Ledger). Les niveaux terminés sont des faits acquis : ils s'ajoutent et ne
 * sont jamais retirés, chaque PC ne connaissant que les niveaux gagnés chez lui. Le total et le
 * niveau en cours ne sont remplacés que par une mesure au moins aussi récente.
 */
async function applyPlaytime(tx: DatabaseOrTransaction, characterId: number, character: CharacterPayload): Promise<void> {
  const playtime = character.playtime;
  if (!playtime) return;

  if (playtime.totalSeconds !== undefined || playtime.current) {
    const values = {
      totalSeconds: playtime.totalSeconds ?? null,
      measuredAt: playtime.measuredAt === undefined ? null : fromUnix(playtime.measuredAt),
      currentLevel: playtime.current?.level ?? null,
      currentLevelStartSeconds: playtime.current?.startTotalSeconds ?? null,
      currentLevelStartedAt: playtime.current?.startedAt === undefined ? null : fromUnix(playtime.current.startedAt),
    };
    await tx
      .insert(t.characterPlaytime)
      .values({ characterId, ...values })
      .onConflictDoUpdate({
        target: t.characterPlaytime.characterId,
        set: values,
        setWhere: sql`${t.characterPlaytime.measuredAt} is null or excluded.measured_at >= ${t.characterPlaytime.measuredAt}`,
      });
  }

  const levels = uniqueBy(playtime.levels, (entry) => entry.level);
  if (levels.length > 0) {
    await tx
      .insert(t.characterLevelTimes)
      .values(
        levels.map((entry) => ({
          characterId,
          level: entry.level,
          playedSeconds: entry.playedSeconds ?? null,
          wallSeconds: entry.wallSeconds ?? null,
          reachedAt: entry.reachedAt === undefined ? null : fromUnix(entry.reachedAt),
          zone: entry.zone ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [t.characterLevelTimes.characterId, t.characterLevelTimes.level],
        // Une valeur connue n'est jamais remplacée par une absence.
        set: {
          playedSeconds: sql`coalesce(excluded.played_seconds, ${t.characterLevelTimes.playedSeconds})`,
          wallSeconds: sql`coalesce(excluded.wall_seconds, ${t.characterLevelTimes.wallSeconds})`,
          reachedAt: sql`coalesce(excluded.reached_at, ${t.characterLevelTimes.reachedAt})`,
          zone: sql`coalesce(excluded.zone, ${t.characterLevelTimes.zone})`,
        },
      });
  }
}

/**
 * Sessions de jeu (Allemano Ledger), identifiées par leur début. Elles s'ajoutent et ne sont jamais
 * retirées : l'addon n'en garde que 50, et chaque PC ne connaît que les siennes. Une session
 * terminée remplace sa version provisoire. Une version provisoire n'en remplace une autre que si
 * elle est au moins aussi récente, et ne remplace jamais une session terminée.
 */
async function applySessions(tx: DatabaseOrTransaction, characterId: number, character: CharacterPayload): Promise<void> {
  const sessions = uniqueBy(character.sessions ?? [], (entry) => entry.startedAt);
  if (sessions.length === 0) return;

  const stored = t.characterSessions;
  await tx
    .insert(stored)
    .values(
      sessions.map((entry) => ({
        characterId,
        startedAt: fromUnix(entry.startedAt),
        stoppedAt: entry.stoppedAt === undefined ? null : fromUnix(entry.stoppedAt),
        durationSeconds: entry.durationSeconds ?? null,
        xpGained: entry.xpGained ?? null,
        levels: entry.levels ?? null,
        zone: entry.zone ?? null,
        tag: entry.tag ?? null,
        inProgress: entry.inProgress,
      })),
    )
    .onConflictDoUpdate({
      target: [stored.characterId, stored.startedAt],
      // Une valeur connue n'est jamais remplacée par une absence.
      set: {
        stoppedAt: sql`coalesce(excluded.stopped_at, ${stored.stoppedAt})`,
        durationSeconds: sql`coalesce(excluded.duration_seconds, ${stored.durationSeconds})`,
        xpGained: sql`coalesce(excluded.xp_gained, ${stored.xpGained})`,
        levels: sql`coalesce(excluded.levels, ${stored.levels})`,
        zone: sql`coalesce(excluded.zone, ${stored.zone})`,
        tag: sql`coalesce(excluded.tag, ${stored.tag})`,
        inProgress: sql`excluded.in_progress`,
      },
      setWhere: sql`not excluded.in_progress or (${stored.inProgress} and (${stored.stoppedAt} is null or excluded.stopped_at >= ${stored.stoppedAt}))`,
    });
}
