import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import type { AgentFile } from "@/lib/agent-download";
import { createAgentToken, revokeAgentToken } from "@/lib/agent-tokens";
import { RateLimiter } from "@/lib/rate-limit";
import { handleAgentUpdateRequest, type AgentUpdateDependencies } from "./agent-update";

const AGENT: AgentFile = { path: "/app/agent/AltBoardSync.exe", size: 4, sha256: "b".repeat(64) };
const CONTENT = Buffer.from("MZ\x90\x00");

let database: TestDatabase;
let token: string;
let tokenId: number;
let logs: Record<string, unknown>[];

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  logs = [];
  ({ token, id: tokenId } = await createAgentToken(database.db, "PC de test"));
});

function download(bearer: string | null, overrides: Partial<AgentUpdateDependencies> = {}) {
  return handleAgentUpdateRequest(
    new Request("https://wow.example.test/api/sync/agent", { headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` } }),
    {
      db: database.db,
      rateLimiter: new RateLimiter(),
      findAgent: async () => AGENT,
      version: "0.9.0",
      log: (event) => logs.push(event),
      readAgent: async (path) => {
        assert.equal(path, AGENT.path);
        return CONTENT;
      },
      ...overrides,
    },
  );
}

describe("GET /api/sync/agent", () => {
  test("rend l'exécutable à un agent authentifié, avec sa version et son empreinte", async () => {
    const response = await download(token);

    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), CONTENT);
    assert.equal(response.headers.get("x-agent-version"), "0.9.0");
    assert.equal(response.headers.get("x-agent-sha256"), AGENT.sha256);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.ok(logs.some((event) => event.event === "agent.update_download" && event.tokenId === tokenId));
  });

  test("refuse sans jeton, avec un jeton inconnu ou révoqué", async () => {
    assert.equal((await download(null)).status, 401);
    assert.equal((await download("wab_inconnu-0123456789abcdefghij")).status, 401);
    await revokeAgentToken(database.db, tokenId, new Date());
    const revoked = await download(token);
    assert.equal(revoked.status, 401);
    assert.equal(revoked.headers.get("x-agent-version"), null);
  });

  test("404 quand le serveur n'a pas d'exécutable ou ne connaît pas sa version", async () => {
    assert.equal((await download(token, { findAgent: async () => null })).status, 404);
    assert.equal((await download(token, { version: null })).status, 404);
  });

  test("les jetons refusés comptent avec ceux de /api/sync et bloquent le téléchargement", async () => {
    const limiter = new RateLimiter();
    const headers = { "x-real-ip": "203.0.113.7" };
    const request = (bearer: string) =>
      handleAgentUpdateRequest(new Request("https://wow.example.test/api/sync/agent", { headers: { ...headers, authorization: `Bearer ${bearer}` } }), {
        db: database.db,
        rateLimiter: limiter,
        findAgent: async () => AGENT,
        version: "0.9.0",
        log: () => {},
        trustedIpHeader: "x-real-ip",
        readAgent: async () => CONTENT,
      });
    for (let i = 0; i < 10; i++) assert.equal((await request(`wab_faux-jeton-${i}-0123456789abcdefgh`)).status, 401);

    const blocked = await request(token);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });
});
