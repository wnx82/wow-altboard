import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import type { AssistantConfig } from "./assistant";
import { AUDIT_QUESTION, listDailyAudits, writeDailyAudit } from "./daily-audit";
import { loadFacts } from "./facts-service";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");
const CONFIG: AssistantConfig = { provider: "openai", url: "http://llm.test/v1", model: "modele-test", apiKey: null, timeoutMs: 1_000, reasoningEffort: null };

/** Faux serveur compatible OpenAI : renvoie le texte donné et garde le corps de chaque requête. */
function llm(content: string) {
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

let database: TestDatabase;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

async function syncPrices() {
  const { id } = await createAgentToken(database.db, "PC de test");
  await processSync(database.db, structuredClone(BASE), { tokenId: id, requestId: "test", now: NOW });
}

describe("audit du jour", () => {
  test("sans aucun prix reçu : données insuffisantes, l'assistant n'est pas appelé", async () => {
    const { fetchImpl, bodies } = llm("rien");

    const result = await writeDailyAudit(database.db, CONFIG, { now: NOW }, fetchImpl);

    assert.deepEqual(result, { ok: false, error: "Données insuffisantes : aucun prix reçu." });
    assert.equal(bodies.length, 0);
    assert.equal(await countRows(database.db, t.economyAudits), 0);
  });

  test("rédigé à partir des faits du calcul conservé, puis relu sans rappeler l'assistant", async () => {
    await syncPrices();
    const { facts, run } = (await loadFacts(database.db, { now: NOW }))!;
    const text = `Dernier relevé le ${facts.market.lastScanDay} : ${facts.market.itemsTracked} objets suivis.`;
    const { fetchImpl, bodies } = llm(text);

    const result = await writeDailyAudit(database.db, CONFIG, { now: NOW }, fetchImpl);

    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(bodies.length, 1);
    const user = bodies[0].messages.find((m) => m.role === "user")!.content;
    assert.ok(user.includes(AUDIT_QUESTION));
    assert.ok(user.includes(`"run":${run.id}`));
    const [audit] = await listDailyAudits(database.db, result.marketId);
    assert.deepEqual(audit, { day: "2026-11-06", runId: run.id, dataThrough: run.dataThrough, model: "modele-test", text, writtenAt: NOW });
  });

  test("un par jour : réécrit le même jour, ajouté le lendemain, le plus récent d'abord", async () => {
    await syncPrices();
    const first = await writeDailyAudit(database.db, CONFIG, { now: NOW }, llm("Premier jet.").fetchImpl);
    const rewritten = await writeDailyAudit(database.db, CONFIG, { now: new Date("2026-11-06T21:00:00Z") }, llm("Second jet.").fetchImpl);
    // 23 h 30 UTC le 6 : déjà le 7 à Bruxelles.
    const nextDay = await writeDailyAudit(database.db, CONFIG, { now: new Date("2026-11-06T23:30:00Z") }, llm("Lendemain.").fetchImpl);

    assert.ok(first.ok && rewritten.ok && nextDay.ok);
    const audits = await listDailyAudits(database.db, first.marketId);
    assert.deepEqual(
      audits.map((a) => [a.day, a.text]),
      [
        ["2026-11-07", "Lendemain."],
        ["2026-11-06", "Second jet."],
      ],
    );
  });

  test("un nombre absent des faits fait refuser l'audit : celui déjà écrit est gardé", async () => {
    await syncPrices();
    const kept = await writeDailyAudit(database.db, CONFIG, { now: NOW }, llm("Audit fondé.").fetchImpl);

    const refused = await writeDailyAudit(database.db, CONFIG, { now: NOW }, llm("Le lingot vaudra 987 654 po demain.").fetchImpl);

    assert.equal(refused.ok, false);
    assert.match(!refused.ok ? refused.error : "", /valeurs absentes des faits du moteur \(987654\)/);
    assert.ok(kept.ok);
    assert.deepEqual(
      (await listDailyAudits(database.db, kept.marketId)).map((a) => a.text),
      ["Audit fondé."],
    );
  });

  test("assistant injoignable : la raison est rendue, rien n'est écrit", async () => {
    await syncPrices();
    const down = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("EHOSTUNREACH"), { code: "EHOSTUNREACH" }) });
    }) as unknown as typeof fetch;

    const result = await writeDailyAudit(database.db, CONFIG, { now: NOW }, down);

    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /injoignable/);
    assert.equal(await countRows(database.db, t.economyAudits), 0);
  });
});
