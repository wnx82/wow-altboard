"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { describeError } from "@/lib/errors";
import { clientKey, RateLimiter } from "@/lib/rate-limit";
import { verifyAgainstDummy, verifyPassword } from "./password";
import { clearSessionCookie, createSession, deleteSession, setSessionCookie } from "./session";

export type LoginState = { error?: string };

const ATTEMPTS = { max: 5, windowMs: 15 * 60_000 };
const limiter = new RateLimiter();

/** Destination après connexion : uniquement un chemin interne, jamais une URL fournie telle quelle. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const client = clientKey(await headers(), process.env.WOW_TRUSTED_IP_HEADER || undefined);

  // Même message quel que soit le motif : ni l'existence du compte ni la cause du refus ne fuitent.
  const refused: LoginState = { error: "Identifiants invalides, ou trop de tentatives. Réessayez plus tard." };
  if (!email || !password || email.length > 254 || password.length > 1024) return refused;
  if (!limiter.consume(`login:client:${client}`, ATTEMPTS) || !limiter.consume(`login:email:${email}`, ATTEMPTS)) return refused;

  try {
    const db = getDatabase();
    const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
    const valid = user?.active ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);
    if (!user || !valid) {
      console.warn(JSON.stringify({ event: "auth.login.failed" }));
      return refused;
    }

    const now = new Date();
    await setSessionCookie(await createSession(db, user.id, now));
    await db.update(adminUsers).set({ lastLoginAt: now }).where(eq(adminUsers.id, user.id));
    console.log(JSON.stringify({ event: "auth.login.succeeded", userId: user.id }));
  } catch (error) {
    console.error(JSON.stringify({ event: "auth.login.unavailable", error: describeError(error) }));
    return { error: "Service momentanément indisponible. Réessayez dans un instant." };
  }

  // Hors du try : redirect() fonctionne en levant une exception de contrôle.
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await deleteSession(getDatabase(), await clearSessionCookie());
  redirect("/login");
}
