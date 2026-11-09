import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { RateLimiter } from "@/lib/rate-limit";
import { verifyPassword } from "./password";
import type { Session } from "./session";

const ATTEMPTS = { max: 5, windowMs: 15 * 60_000 };
const limiter = new RateLimiter();

/**
 * Redemande le mot de passe avant une suppression définitive : une session seule ne suffit pas.
 * Renvoie le message à afficher, ou null si le mot de passe est le bon. `scope` nomme l'action :
 * chacune a son propre compteur de tentatives et son événement de refus dans les journaux.
 */
export async function confirmPassword(db: Database, session: Session, password: string, scope: string): Promise<string | null> {
  if (!password || password.length > 1024) return "Saisissez votre mot de passe pour confirmer.";
  if (!limiter.consume(`${scope}:${session.userId}`, ATTEMPTS)) return "Trop de tentatives. Réessayez dans quelques minutes.";
  const [user] = await db.select({ passwordHash: adminUsers.passwordHash }).from(adminUsers).where(eq(adminUsers.id, session.userId));
  if (user && (await verifyPassword(password, user.passwordHash))) return null;
  console.warn(JSON.stringify({ event: `${scope}_refused`, userId: session.userId }));
  return "Mot de passe incorrect.";
}
