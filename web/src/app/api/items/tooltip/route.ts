import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { getItemTooltip } from "@/lib/wow/item-tooltips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
// Une bulle connue change rarement : le navigateur la garde une heure.
const CACHED = { "Cache-Control": "private, max-age=3600" };
// Survoler une grille ouvre une bulle par case : large, mais borné.
const LIMIT = { max: 600, windowMs: 60_000 };
const limiter = new RateLimiter();

// Bulle d'un objet à la manière de Wowhead (?key=1234 ou 1234:567), en lignes structurées. Le
// proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: NO_STORE });
  if (!limiter.consume(`tooltip:${session.userId}`, LIMIT)) return Response.json({ error: "Trop de demandes." }, { status: 429, headers: NO_STORE });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^[\w:]{1,40}$/.test(key)) return Response.json({ error: "Clé d'objet illisible." }, { status: 400, headers: NO_STORE });
  const tooltip = await getItemTooltip(getDatabase(), key, { now: new Date() });
  if (tooltip.status === "unavailable") return Response.json({ status: "unavailable" }, { headers: NO_STORE });
  return Response.json({ status: tooltip.status, lines: tooltip.lines }, { headers: CACHED });
}
