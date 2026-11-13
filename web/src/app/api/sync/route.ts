import { getDatabase } from "@/db/client";
import { RateLimiter } from "@/lib/rate-limit";
import { SyncGate } from "@/lib/sync/gate";
import { handleSyncRequest } from "@/lib/sync/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rateLimiter = new RateLimiter();
const gate = new SyncGate();

export async function POST(request: Request): Promise<Response> {
  return handleSyncRequest(request, {
    db: getDatabase(),
    rateLimiter,
    gate,
    latestAgentVersion: process.env.WOW_AGENT_VERSION || null,
    trustedIpHeader: process.env.WOW_TRUSTED_IP_HEADER || undefined,
  });
}
