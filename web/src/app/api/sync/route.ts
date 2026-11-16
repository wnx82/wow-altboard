import { getDatabase } from "@/db/client";
import { agentDirectory, findAgent } from "@/lib/agent-download";
import { SyncGate } from "@/lib/sync/gate";
import { handleSyncRequest } from "@/lib/sync/handler";
import { syncRateLimiter } from "@/lib/sync/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gate = new SyncGate();

export async function POST(request: Request): Promise<Response> {
  return handleSyncRequest(request, {
    db: getDatabase(),
    rateLimiter: syncRateLimiter(),
    gate,
    latestAgentVersion: process.env.WOW_AGENT_VERSION || null,
    latestAgentSha256: async () => (await findAgent(agentDirectory()))?.sha256 ?? null,
    trustedIpHeader: process.env.WOW_TRUSTED_IP_HEADER || undefined,
  });
}
