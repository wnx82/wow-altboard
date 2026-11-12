import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { searchEverything } from "@/lib/dashboard/global-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

// Recherche globale (Ctrl+K) : personnages et objets, en JSON. Le proxy ne couvre pas /api : la
// session est vérifiée ici.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Authentification requise." }, { status: 401, headers: NO_STORE });
  const results = await searchEverything(getDatabase(), new URL(request.url).searchParams.get("q"));
  return Response.json(results, { headers: NO_STORE });
}
