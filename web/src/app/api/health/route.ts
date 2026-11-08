import { sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Construction en service : après un déploiement, elle se vérifie sans session. Le dépôt est public,
// ces deux valeurs n'apprennent rien qu'il ne dise déjà.
const build = {
  version: process.env.WOW_SITE_VERSION || null,
  commit: process.env.WOW_BUILD_COMMIT || null,
};

// Sonde de disponibilité pour l'orchestrateur. Publique : état de la base et construction, rien d'autre.
export async function GET(): Promise<Response> {
  try {
    await getDatabase().execute(sql`select 1`);
    return Response.json({ status: "ok", ...build }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable", ...build },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
