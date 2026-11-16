import { getDatabase } from "@/db/client";
import { agentDirectory, findAgent } from "@/lib/agent-download";
import { handleAgentUpdateRequest } from "@/lib/sync/agent-update";
import { syncRateLimiter } from "@/lib/sync/limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L'agent se met à jour ici, avec son jeton : la page Machines (/api/agent) exige une session.
export async function GET(request: Request): Promise<Response> {
  return handleAgentUpdateRequest(request, {
    db: getDatabase(),
    rateLimiter: syncRateLimiter(),
    findAgent: () => findAgent(agentDirectory()),
    version: process.env.WOW_AGENT_VERSION || null,
    trustedIpHeader: process.env.WOW_TRUSTED_IP_HEADER || undefined,
  });
}
