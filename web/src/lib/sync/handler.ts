import { randomUUID } from "node:crypto";
import type { Database } from "@/db/client";
import { findActiveToken, parseBearerToken } from "@/lib/agent-tokens";
import { describeError } from "@/lib/errors";
import { clientKey, type RateLimiter } from "@/lib/rate-limit";
import { futureTimestamps } from "./clock";
import { processSync, recordFailedRun, TokenMachineMismatchError } from "./process";
import { SUPPORTED_SCHEMA_VERSION, syncPayloadSchema } from "./schema";

export type SyncDependencies = {
  db: Database;
  rateLimiter: RateLimiter;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
  maxBodyBytes?: number;
  trustedIpHeader?: string;
};

// Les prix Auctionator pèsent l'essentiel du document : environ 500 Ko par compte et par mois de relevés.
export const DEFAULT_MAX_BODY_BYTES = 24 * 1024 * 1024;
const REQUESTS_PER_CLIENT = { max: 60, windowMs: 5 * 60_000 };
const AUTH_FAILURES_PER_CLIENT = { max: 10, windowMs: 15 * 60_000 };

class PayloadTooLargeError extends Error {}

/** Lit le corps sans jamais dépasser la limite, que Content-Length soit présent, absent ou faux. */
async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new PayloadTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    parts.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/**
 * POST /api/sync. Chaque refus est décidé avant tout accès aux données : limite de débit,
 * jeton, type et taille du corps, version, schéma strict. Aucune réponse ni aucun journal ne
 * reprend le contenu reçu.
 */
export async function handleSyncRequest(request: Request, deps: SyncDependencies): Promise<Response> {
  const requestId = randomUUID();
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.now();
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const client = clientKey(request.headers, deps.trustedIpHeader);

  const respond = (status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) =>
    Response.json(
      { ...body, requestId },
      { status, headers: { "Cache-Control": "no-store", "X-Request-ID": requestId, ...extraHeaders } },
    );
  const reject = (status: number, code: string, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    log({ event: "sync.rejected", requestId, status, code });
    return respond(status, { error, code, ...extra }, headers);
  };

  if (
    !deps.rateLimiter.consume(`sync:client:${client}`, REQUESTS_PER_CLIENT) ||
    deps.rateLimiter.isBlocked(`sync:auth:${client}`, AUTH_FAILURES_PER_CLIENT)
  ) {
    return reject(429, "rate_limited", "Trop de requêtes, réessayez plus tard.", {}, { "Retry-After": "300" });
  }

  const token = parseBearerToken(request.headers.get("authorization"));
  let tokenId: number | null;
  try {
    tokenId = token === null ? null : await findActiveToken(deps.db, token);
  } catch (error) {
    // Base injoignable : l'agent doit savoir qu'il peut réessayer, pas que son jeton est refusé.
    log({ event: "sync.unavailable", requestId, error: describeError(error) });
    return respond(503, { error: "Service momentanément indisponible, réessayez plus tard.", code: "service_unavailable" }, { "Retry-After": "60" });
  }
  if (tokenId === null) {
    deps.rateLimiter.consume(`sync:auth:${client}`, AUTH_FAILURES_PER_CLIENT);
    return reject(401, "unauthorized", "Jeton d'agent absent, invalide ou révoqué.", {}, { "WWW-Authenticate": "Bearer" });
  }

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return reject(415, "unsupported_media_type", "Le corps doit être en application/json.");
  }

  let raw: Uint8Array;
  try {
    raw = await readBoundedBody(request, deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return reject(413, "payload_too_large", "Document trop volumineux.");
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return reject(400, "invalid_json", "Le corps n'est pas un JSON valide.");
  }

  const declaredVersion = typeof json === "object" && json !== null ? (json as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (typeof declaredVersion === "number" && declaredVersion !== SUPPORTED_SCHEMA_VERSION) {
    return reject(422, "unsupported_schema_version", "Version de document non prise en charge : mettez l'agent à jour.", {
      supported: [SUPPORTED_SCHEMA_VERSION],
    });
  }

  const parsed = syncPayloadSchema.safeParse(json);
  if (!parsed.success) {
    // Chemins et codes seulement : jamais les valeurs reçues.
    const issues = parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.join("."), code: issue.code }));
    return reject(422, "invalid_payload", "Document de synchronisation invalide.", { issues });
  }

  const payload = parsed.data;
  const future = futureTimestamps(payload, now);
  if (future.length > 0) {
    return reject(422, "future_timestamp", "Date postérieure à l'heure du serveur : l'horloge de ce PC est-elle en avance ?", {
      issues: future.map((path) => ({ path, code: "future_timestamp" })),
    });
  }
  const summary = {
    machine: payload.machine.uuid,
    agentVersion: payload.agentVersion,
    accounts: payload.accounts.length,
    characters: payload.accounts.reduce((total, account) => total + account.characters.length, 0),
  };

  try {
    const result = await processSync(deps.db, payload, { tokenId, requestId, now });
    log({ event: "sync.received", requestId, ...summary, durationMs: Date.now() - started, result: { ...result, errors: result.errors.length } });
    return respond(200, result);
  } catch (error) {
    if (error instanceof TokenMachineMismatchError) {
      return reject(403, "token_machine_mismatch", "Ce jeton est déjà lié à une autre machine.");
    }

    const message = describeError(error);
    log({ event: "sync.failed", requestId, ...summary, durationMs: Date.now() - started, error: message });
    try {
      await recordFailedRun(deps.db, {
        requestId,
        now,
        machineUuid: payload.machine.uuid,
        agentVersion: payload.agentVersion,
        schemaVersion: payload.schemaVersion,
        code: "internal_error",
        message,
      });
    } catch {
      // La base est peut-être indisponible : l'échec reste tracé dans le journal applicatif.
    }
    return respond(500, { error: "Erreur interne : la synchronisation a été annulée.", code: "internal_error" });
  }
}
