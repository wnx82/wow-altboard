"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { getDatabase } from "@/db/client";
import { machines, wowAccounts } from "@/db/schema";
import { createAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { confirmPassword } from "@/lib/auth/confirm-password";
import { requireSession } from "@/lib/auth/session";
import { describeError } from "@/lib/errors";
import { isSyncBusy, SYNC_BUSY_MESSAGE } from "@/lib/sync/process";
import { deleteAccount } from "./delete-account";
import { setAccountFavorite } from "./favorite-account";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const id = z.coerce.number().int().positive();
const name = z.string().trim().max(60).regex(/^[^\u0000]*$/);

export type ActionState = { error?: string; saved?: boolean };

/** Renomme un compte. Un nom vide rétablit le libellé par défaut. */
export async function renameAccountAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z.object({ id, name }).safeParse({ id: formData.get("id"), name: formData.get("name") ?? "" });
  if (!parsed.success) return { error: "Nom invalide (60 caractères maximum)." };
  await getDatabase()
    .update(wowAccounts)
    .set({ displayName: parsed.data.name || null, updatedAt: new Date() })
    .where(eq(wowAccounts.id, parsed.data.id));
  revalidatePath("/", "layout");
  return { saved: true };
}

/**
 * Ajoute un compte aux favoris (en avant à l'accueil), ou l'en retire. Un échec revient en message :
 * l'étoile, déjà basculée à l'écran, reprend son état et la page reste en place.
 */
export async function setAccountFeaturedAction(formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z
    .object({ id, featured: z.enum(["0", "1"]) })
    .safeParse({ id: formData.get("id"), featured: formData.get("featured") });
  if (!parsed.success) return { error: "Demande invalide." };

  let found: boolean;
  try {
    found = await setAccountFavorite(getDatabase(), parsed.data.id, parsed.data.featured === "1");
  } catch (error) {
    console.error(JSON.stringify({ event: "account.favorite.failed", accountId: parsed.data.id, error: describeError(error) }));
    return { error: "Échec de l'enregistrement. Réessayez." };
  }
  revalidatePath("/", "layout");
  return found ? { saved: true } : { error: "Ce compte n'existe plus." };
}

/** Renomme une machine. Un nom vide rétablit le nom d'hôte. */
export async function renameMachineAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();
  const parsed = z.object({ id, name }).safeParse({ id: formData.get("id"), name: formData.get("name") ?? "" });
  if (!parsed.success) return { error: "Nom invalide (60 caractères maximum)." };
  await getDatabase()
    .update(machines)
    .set({ displayName: parsed.data.name || null, updatedAt: new Date() })
    .where(eq(machines.id, parsed.data.id));
  revalidatePath("/", "layout");
  return { saved: true };
}

export type DeleteAccountState = { error?: string };

/** Supprime un compte et ses personnages. Suppression définitive : le mot de passe est redemandé. */
export async function deleteAccountAction(_previous: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const session = await requireSession();
  const parsed = id.safeParse(formData.get("id"));
  if (!parsed.success) return { error: "Compte inconnu." };
  const password = formData.get("password");

  const db = getDatabase();
  const refused = await confirmPassword(db, session, typeof password === "string" ? password : "", "account.delete");
  if (refused) return { error: refused };

  let deleted;
  try {
    deleted = await deleteAccount(db, parsed.data);
  } catch (error) {
    if (isSyncBusy(error)) return { error: SYNC_BUSY_MESSAGE };
    throw error;
  }
  if (!deleted) return { error: "Ce compte n'existe plus." };
  console.log(JSON.stringify({ event: "account.deleted", userId: session.userId, accountId: parsed.data, ...deleted }));
  revalidatePath("/", "layout");
  return {};
}

export type TokenState = { error?: string; token?: string; label?: string };

/** Crée un jeton d'agent. Il n'est renvoyé qu'ici, une seule fois : seule son empreinte est stockée. */
export async function createTokenAction(_previous: TokenState, formData: FormData): Promise<TokenState> {
  await requireSession();
  const parsed = name.min(1).safeParse(formData.get("label") ?? "");
  if (!parsed.success) return { error: "Indiquez un libellé (60 caractères maximum), par exemple le nom du PC." };
  const { token } = await createAgentToken(getDatabase(), parsed.data);
  console.log(JSON.stringify({ event: "agent_token.created" }));
  revalidatePath("/machines");
  return { token, label: parsed.data };
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  await requireSession();
  const parsed = id.safeParse(formData.get("id"));
  if (!parsed.success) return;
  if (await revokeAgentToken(getDatabase(), parsed.data, new Date())) console.log(JSON.stringify({ event: "agent_token.revoked", tokenId: parsed.data }));
  revalidatePath("/machines");
}
