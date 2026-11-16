import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Database } from "@/db/client";
import type { AgentFile } from "@/lib/agent-download";
import { findActiveToken, parseBearerToken } from "@/lib/agent-tokens";
import { describeError } from "@/lib/errors";
import { clientKey, type RateLimiter } from "@/lib/rate-limit";
import { AUTH_FAILURES_PER_CLIENT } from "./handler";

export type AgentUpdateDependencies = {
  db: Database;
  rateLimiter: RateLimiter;
  /** L'exécutable servi, celui que la page Machines propose ; null s'il n'y en a pas. */
  findAgent: () => Promise<AgentFile | null>;
  /** Sa version, la même que latestAgentVersion de /api/sync. */
  version: string | null;
  log?: (event: Record<string, unknown>) => void;
  trustedIpHeader?: string;
  readAgent?: (path: string) => Promise<Buffer>;
};

// Un agent ne télécharge qu'en cas de nouvelle version : quelques essais suffisent largement.
const DOWNLOADS_PER_CLIENT = { max: 12, windowMs: 15 * 60_000 };

/**
 * GET /api/sync/agent : l'exécutable de l'agent, pour sa mise à jour automatique (agent 0.9.0 et
 * suivants). Même porte que /api/sync : jeton d'agent, limite de débit, refus comptés ensemble. Sous
 * /api/sync, le chemin hérite de l'exception Cloudflare Access de l'agent. Version et empreinte sont
 * dans les en-têtes ; l'agent vérifie l'empreinte contre celle que /api/sync lui a donnée.
 */
export async function handleAgentUpdateRequest(request: Request, deps: AgentUpdateDependencies): Promise<Response> {
  const requestId = randomUUID();
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const client = clientKey(request.headers, deps.trustedIpHeader);
  const headers = { "Cache-Control": "no-store", "X-Request-ID": requestId };
  const reject = (status: number, code: string, error: string, extra: Record<string, string> = {}) => {
    log({ event: "agent.update_rejected", requestId, status, code });
    return Response.json({ error, code, requestId }, { status, headers: { ...headers, ...extra } });
  };

  if (
    !deps.rateLimiter.consume(`agent-update:client:${client}`, DOWNLOADS_PER_CLIENT) ||
    deps.rateLimiter.isBlocked(`sync:auth:${client}`, AUTH_FAILURES_PER_CLIENT)
  ) {
    return reject(429, "rate_limited", "Trop de requêtes, réessayez plus tard.", { "Retry-After": "900" });
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  let tokenId: number | null;
  try {
    tokenId = token === null ? null : await findActiveToken(deps.db, token);
  } catch (error) {
    log({ event: "agent.update_unavailable", requestId, error: describeError(error) });
    return reject(503, "service_unavailable", "Service momentanément indisponible, réessayez plus tard.", { "Retry-After": "60" });
  }
  if (tokenId === null) {
    deps.rateLimiter.consume(`sync:auth:${client}`, AUTH_FAILURES_PER_CLIENT);
    return reject(401, "unauthorized", "Jeton d'agent absent, invalide ou révoqué.", { "WWW-Authenticate": "Bearer" });
  }

  const agent = deps.version ? await deps.findAgent() : null;
  if (!agent || !deps.version) return reject(404, "agent_unavailable", "Agent non disponible sur ce serveur.");

  const content = await (deps.readAgent ?? readFile)(agent.path);
  log({ event: "agent.update_download", requestId, tokenId, version: deps.version, bytes: content.length });
  return new Response(new Uint8Array(content), {
    headers: {
      ...headers,
      "Content-Type": "application/octet-stream",
      "Content-Length": String(content.length),
      "X-Agent-Version": deps.version,
      "X-Agent-Sha256": agent.sha256,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
