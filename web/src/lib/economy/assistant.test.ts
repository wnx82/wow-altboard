import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { askAssistant, assistantConfig, probeAssistant, ungroundedNumbers, type AssistantConfig } from "./assistant";
import type { EconomyFacts } from "./facts";

const FACTS = {
  version: 1,
  rules: ["Montants en pièces de cuivre : 1 po = 100 pa = 10 000 pc."],
  market: { label: "PvE · WoW Forever", lastScanDay: "2026-11-06", auctionCutPercent: 5 },
  opportunities: [{ rank: 1, kind: "SELL", name: "Lingot de fer", valueCopper: 123_456, confidence: 82, change7d: 0.125 }],
} as unknown as EconomyFacts;

const CONFIG: AssistantConfig = { provider: "openai", url: "http://llm.test/v1", model: "test", apiKey: null, timeoutMs: 1_000, reasoningEffort: null };
const CLAUDE: AssistantConfig = { provider: "anthropic", url: "https://api.anthropic.test", model: "claude-opus-5-5", apiKey: "sk-ant-test", timeoutMs: 1_000, reasoningEffort: null };

/** Erreur levée par le fetch de Node (undici) quand aucune réponse HTTP n'arrive, avec le code de sa cause. */
const fetchFailure = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
/** Même erreur quand plusieurs adresses du nom ont été essayées (IPv6 puis IPv4). */
const aggregateFailure = (code: string) =>
  Object.assign(new TypeError("fetch failed"), { cause: new AggregateError([Object.assign(new Error(code), { code }), Object.assign(new Error(code), { code })]) });

const reply = (content: string, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })) as unknown as typeof fetch;

/** Faux serveur de l'API Messages : garde chaque requête reçue par le SDK. */
function claudeServer(content: unknown[], { stopReason = "end_turn", status = 200 } = {}) {
  const calls: { url: URL; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const body =
      status === 200
        ? { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
        : { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("assistant", () => {
  test("désactivé sans adresse ni modèle ; seule une adresse http(s) est acceptée", () => {
    assert.equal(assistantConfig({}), null);
    assert.equal(assistantConfig({ WOW_AI_URL: "http://10.0.0.5:11434/v1" }), null);
    assert.equal(assistantConfig({ WOW_AI_URL: "file:///etc/passwd", WOW_AI_MODEL: "m" }), null);
    assert.deepEqual(assistantConfig({ WOW_AI_URL: "http://10.0.0.5:11434/v1/", WOW_AI_MODEL: "qwen" }), {
      provider: "openai",
      url: "http://10.0.0.5:11434/v1",
      model: "qwen",
      apiKey: null,
      timeoutMs: 120_000,
      reasoningEffort: null,
    });
  });

  test("Claude : actif avec une clé, adresse et modèle par défaut ; fournisseur inconnu refusé", () => {
    assert.equal(assistantConfig({ WOW_AI_PROVIDER: "anthropic" }), null);
    assert.equal(assistantConfig({ WOW_AI_PROVIDER: "mistral", WOW_AI_URL: "http://10.0.0.5/v1", WOW_AI_MODEL: "m" }), null);
    assert.deepEqual(assistantConfig({ WOW_AI_PROVIDER: " Anthropic ", WOW_AI_API_KEY: "sk-ant-test" }), {
      provider: "anthropic",
      url: "https://api.anthropic.com",
      model: "claude-opus-5-5",
      apiKey: "sk-ant-test",
      timeoutMs: 120_000,
      reasoningEffort: null,
    });
    assert.equal(assistantConfig({ WOW_AI_PROVIDER: "anthropic", WOW_AI_API_KEY: "k", WOW_AI_MODEL: "claude-haiku-5-5" })?.model, "claude-haiku-5-5");
  });

  test("Claude : requête à l'API Messages avec la clé, les règles et la question ; seul le texte est repris", async () => {
    const server = claudeServer([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Vendez le Lingot de fer, " },
      { type: "text", text: "confiance 82." },
    ]);

    const answer = await askAssistant(CLAUDE, FACTS, "Que vendre ?", server.fetchImpl);

    assert.deepEqual(answer, { ok: true, answer: "Vendez le Lingot de fer, confiance 82." });
    assert.equal(server.calls.length, 1);
    const [call] = server.calls;
    assert.equal(call.url.origin + call.url.pathname, "https://api.anthropic.test/v1/messages");
    assert.equal(call.headers.get("authorization"), "Bearer sk-ant-test");
    assert.ok(call.headers.get("anthropic-version"));
    assert.match(call.headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
    assert.equal(call.body.model, "claude-opus-5-5");
    assert.equal(call.body.fallbacks, "default");
    assert.deepEqual(call.body.output_config, { effort: "medium" });
    assert.equal("temperature" in call.body, false);
    assert.match(String(call.body.system), /1 po = 100 pa/);
    const [message] = call.body.messages as { role: string; content: string }[];
    assert.equal(message.role, "user");
    assert.match(message.content, /"Lingot de fer"[\s\S]*Question : Que vendre \?$/);
  });

  test("Claude : sans repli côté serveur hors des modèles qui l'acceptent", async () => {
    const server = claudeServer([{ type: "text", text: "Données insuffisantes." }]);

    await askAssistant({ ...CLAUDE, model: "claude-haiku-5-5" }, FACTS, "?", server.fetchImpl);

    assert.equal("fallbacks" in server.calls[0].body, false);
    assert.doesNotMatch(server.calls[0].headers.get("anthropic-beta") ?? "", /server-side-fallback/);
  });

  test("Claude : clé refusée, question déclinée, réponse tronquée ou inventée signalées", async () => {
    const badKey = await askAssistant(CLAUDE, FACTS, "?", claudeServer([], { status: 401 }).fetchImpl);
    assert.deepEqual(badKey, { ok: false, error: "Clé d'API Anthropic refusée." });

    const declined = await askAssistant(CLAUDE, FACTS, "?", claudeServer([], { stopReason: "refusal" }).fetchImpl);
    assert.deepEqual(declined, { ok: false, error: "Claude a décliné cette question." });

    const truncated = await askAssistant(CLAUDE, FACTS, "?", claudeServer([{ type: "text", text: "Vendez" }], { stopReason: "max_tokens" }).fetchImpl);
    assert.deepEqual(truncated, { ok: false, error: "Réponse de l'assistant tronquée." });

    const invented = await askAssistant(CLAUDE, FACTS, "?", claudeServer([{ type: "text", text: "Le farm rapporte 987 po/h." }]).fetchImpl);
    assert.equal(invented.ok, false);
    assert.match(invented.ok ? "" : invented.error, /987/);

    const empty = await askAssistant(CLAUDE, FACTS, "?", claudeServer([{ type: "thinking", thinking: "", signature: "sig" }]).fetchImpl);
    assert.deepEqual(empty, { ok: false, error: "Réponse de l'assistant illisible." });
  });

  test("les nombres des faits sont reconnus sous toutes leurs écritures", () => {
    const answer = "Vendez le Lingot de fer : 12 po 34 pa 56 pc (123 456 pc, soit 12,35 po), confiance 82, +12,5 % sur 7 jours, relevé du 06/11/2026.";

    assert.deepEqual(ungroundedNumbers(answer, FACTS), []);
  });

  test("un nombre absent des faits est signalé ; les petits entiers restent libres", () => {
    assert.deepEqual(ungroundedNumbers("Comptez 3 crafts et 4 500 po/h.", FACTS), ["4500"]);
  });

  test("réponse fondée transmise ; réponse inventée refusée ; panne signalée", async () => {
    const good = await askAssistant(CONFIG, FACTS, "Que vendre ?", reply("Vendez le Lingot de fer, confiance 82."));
    assert.deepEqual(good, { ok: true, answer: "Vendez le Lingot de fer, confiance 82." });

    const invented = await askAssistant(CONFIG, FACTS, "Que vendre ?", reply("Le farm rapporte 987 po/h."));
    assert.equal(invented.ok, false);
    assert.match(invented.ok ? "" : invented.error, /987/);

    const down = await askAssistant(CONFIG, FACTS, "?", (async () => {
      throw new Error("panne inconnue");
    }) as unknown as typeof fetch);
    assert.deepEqual(down, { ok: false, error: "L'assistant ne répond pas." });

    const refused = await askAssistant(CONFIG, FACTS, "?", reply("", 500));
    assert.equal(refused.ok, false);
  });

  test("la question elle-même peut fournir un nombre que la réponse reprend", async () => {
    const answer = await askAssistant(CONFIG, FACTS, "Ai-je 250 lingots ?", reply("Les faits ne montrent pas vos 250 lingots : données insuffisantes."));

    assert.equal(answer.ok, true);
  });

  test("effort de réflexion : lu pour l'API compatible OpenAI seulement ; valeur inconnue refusée", () => {
    const local = { WOW_AI_URL: "http://10.0.0.5:11434/v1", WOW_AI_MODEL: "qwen3.5:9b" };

    assert.equal(assistantConfig({ ...local, WOW_AI_REASONING_EFFORT: " None " })?.reasoningEffort, "none");
    assert.equal(assistantConfig(local)?.reasoningEffort, null);
    assert.equal(assistantConfig({ ...local, WOW_AI_REASONING_EFFORT: "off" }), null);
    assert.equal(assistantConfig({ WOW_AI_PROVIDER: "anthropic", WOW_AI_API_KEY: "k", WOW_AI_REASONING_EFFORT: "none" })?.reasoningEffort, null);
  });

  test("effort de réflexion transmis tel quel ; absent sans réglage", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = (async (_input: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Données insuffisantes." }, finish_reason: "stop" }] }));
    }) as unknown as typeof fetch;

    await askAssistant({ ...CONFIG, reasoningEffort: "none" }, FACTS, "?", capture);
    await askAssistant(CONFIG, FACTS, "?", capture);

    assert.equal(bodies[0].reasoning_effort, "none");
    assert.equal("reasoning_effort" in bodies[1], false);
  });

  test("machine éteinte, connexion coupée ou délai dépassé : chaque cause a son message", async () => {
    const answer = async (error: unknown) => {
      const result = await askAssistant(CONFIG, FACTS, "?", (async () => {
        throw error;
      }) as unknown as typeof fetch);
      return result.ok ? "" : result.error;
    };

    for (const error of [fetchFailure("EHOSTUNREACH"), fetchFailure("UND_ERR_CONNECT_TIMEOUT"), fetchFailure("ENOTFOUND"), aggregateFailure("ECONNREFUSED")]) {
      assert.match(await answer(error), /^Serveur de l'assistant injoignable : la machine qui l'héberge est sans doute éteinte/);
    }
    assert.match(await answer(fetchFailure("UND_ERR_SOCKET")), /^Connexion au serveur de l'assistant coupée pendant la réponse/);
    assert.equal(await answer(new DOMException("The operation was aborted due to timeout", "TimeoutError")), "L'assistant n'a pas répondu en 1 s.");
  });

  test("sonde : toute réponse HTTP vaut serveur allumé ; machine muette ou injoignable signalée ; Claude jamais sondé", async () => {
    const urls: string[] = [];
    const answering = (status: number) =>
      (async (input: string | URL) => {
        urls.push(String(input));
        return new Response("{}", { status });
      }) as unknown as typeof fetch;
    const failing = (error: unknown) =>
      (async () => {
        throw error;
      }) as unknown as typeof fetch;

    assert.deepEqual(await probeAssistant(CONFIG, answering(200)), { up: true });
    assert.deepEqual(await probeAssistant(CONFIG, answering(404)), { up: true });
    assert.deepEqual(urls, ["http://llm.test/v1/models", "http://llm.test/v1/models"]);

    for (const error of [fetchFailure("EHOSTUNREACH"), new DOMException("The operation was aborted due to timeout", "TimeoutError")]) {
      const status = await probeAssistant(CONFIG, failing(error));
      assert.equal(status.up, false);
      assert.match(status.up ? "" : status.error, /^Serveur de l'assistant injoignable/);
    }

    assert.deepEqual(await probeAssistant(CLAUDE, failing(fetchFailure("EHOSTUNREACH"))), { up: true });
  });

  test("réponse coupée par le serveur (contexte plein) : cause signalée, même avec un début de texte", async () => {
    const cut = (content: string) =>
      (async () => new Response(JSON.stringify({ choices: [{ message: { content, reasoning: "…" }, finish_reason: "length" }] }))) as unknown as typeof fetch;

    for (const content of ["", "Vendez le Lingot"]) {
      const answer = await askAssistant(CONFIG, FACTS, "?", cut(content));
      assert.equal(answer.ok, false);
      assert.match(answer.ok ? "" : answer.error, /^Réponse coupée : le contexte du modèle est plein\..*WOW_AI_REASONING_EFFORT=none/);
    }
  });
});
