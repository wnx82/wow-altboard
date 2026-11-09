import { eq, lt, max, min, notExists, sql } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "@/db/client";
import { characters, realms } from "@/db/schema";
import { SYNC_LOCK_KEY } from "@/lib/sync/process";
import { writeSettings } from "./store";

// Réinitialisation des personnages, prévue pour la sortie officielle du jeu : ceux de la bêta
// n'existent plus côté Blizzard, mais leurs fichiers restent sur les PC.

export type ResetResult = { deleted: number; kept: number };

/**
 * Supprime les personnages non vus en jeu depuis `cutoff`, avec tout leur historique (tables
 * filles en cascade), et retient cette date : la synchronisation ignore ensuite tout personnage
 * inconnu plus ancien. Sans cela, le premier envoi d'un PC qui garde le fichier de la bêta les
 * recréerait tous.
 */
export async function resetCharacters(db: Database, cutoff: Date, now: Date): Promise<ResetResult> {
  return db.transaction(async (tx) => {
    // Verrou des synchronisations : aucune ne s'intercale entre la suppression et la date limite.
    await tx.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`);
    const deleted = await tx.delete(characters).where(lt(characters.sourceLastSeenAt, cutoff)).returning({ id: characters.id });
    await deleteEmptyRealms(tx);
    const [remaining] = await tx.select({ count: sql<number>`count(*)::int` }).from(characters);
    await writeSettings(tx, { charactersCutoffAt: cutoff, charactersResetAt: now }, now);
    return { deleted: deleted.length, kept: remaining.count };
  });
}

/** Un royaume sans personnage n'apparaît nulle part : après une suppression, il ne reste pas en base. */
export async function deleteEmptyRealms(db: DatabaseOrTransaction): Promise<void> {
  await db.delete(realms).where(notExists(db.select({ id: characters.id }).from(characters).where(eq(characters.realmId, realms.id))));
}

export type CharacterSummary = { count: number; oldestSeenAt: Date | null; newestSeenAt: Date | null };

/** Ce que la réinitialisation toucherait : nombre de personnages et étendue de leurs dernières connexions. */
export async function characterSummary(db: Database): Promise<CharacterSummary> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldestSeenAt: min(characters.sourceLastSeenAt),
      newestSeenAt: max(characters.sourceLastSeenAt),
    })
    .from(characters);
  return row;
}
