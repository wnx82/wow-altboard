import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { wowAccounts } from "@/db/schema";

/**
 * Ajoute un compte aux favoris ou l'en retire : ses personnages passent en premier à l'accueil.
 * Faux si le compte n'existe plus (supprimé depuis l'affichage de la page).
 */
export async function setAccountFavorite(db: Database, accountId: number, favorite: boolean, now = new Date()): Promise<boolean> {
  const updated = await db
    .update(wowAccounts)
    .set({ featured: favorite, updatedAt: now })
    .where(eq(wowAccounts.id, accountId))
    .returning({ id: wowAccounts.id });
  return updated.length > 0;
}
