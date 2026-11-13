import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { characters, machineAccounts, marketImports, wowAccounts } from "@/db/schema";
import { deleteEmptyRealms } from "@/lib/settings/reset";
import { type SyncLockOptions, takeSyncLock } from "@/lib/sync/process";

// Suppression manuelle d'un compte, par exemple la copie d'un dossier WTF\Account qu'un PC n'a
// envoyée qu'une fois. Les prix déjà relevés restent : ils sont fusionnés jour par jour avec ceux
// des autres comptes et ne peuvent plus en être séparés.

export type DeletedAccount = { characters: number; marketImports: number };

/**
 * Supprime un compte avec ses personnages (et tout leur historique, en cascade), ses imports de
 * marché et ses liens aux machines. Null si le compte n'existe pas. Un PC qui garde le dossier le
 * recrée dès que l'agent renvoie le fichier, c'est-à-dire quand celui-ci change.
 */
export async function deleteAccount(db: Database, accountId: number, lock: SyncLockOptions = {}): Promise<DeletedAccount | null> {
  return db.transaction(async (tx) => {
    // Verrou des synchronisations : aucune ne rattache un personnage au compte pendant sa suppression.
    await takeSyncLock(tx, lock);
    const [account] = await tx.select({ id: wowAccounts.id }).from(wowAccounts).where(eq(wowAccounts.id, accountId));
    if (!account) return null;
    const deletedCharacters = await tx.delete(characters).where(eq(characters.accountId, accountId)).returning({ id: characters.id });
    const deletedImports = await tx.delete(marketImports).where(eq(marketImports.accountId, accountId)).returning({ id: marketImports.id });
    await tx.delete(machineAccounts).where(eq(machineAccounts.accountId, accountId));
    await tx.delete(wowAccounts).where(eq(wowAccounts.id, accountId));
    await deleteEmptyRealms(tx);
    return { characters: deletedCharacters.length, marketImports: deletedImports.length };
  });
}
