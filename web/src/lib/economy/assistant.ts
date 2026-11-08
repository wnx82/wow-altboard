import { ANTHROPIC_MODEL, ANTHROPIC_URL, completeWithClaude, type Completion } from "./assistant-claude";
import { formatCopperShort } from "./view";
import type { EconomyFacts } from "./facts";

// Assistant facultatif (P11) : explique les faits du moteur en langage naturel. Il ne reçoit que les
// faits structurés, ne lance aucune requête, et toute réponse qui cite un nombre absent des faits est
// refusée. Deux fournisseurs, selon WOW_AI_PROVIDER :
// - « openai » (défaut) : API « chat completions » compatible OpenAI (Ollama, LM Studio, vLLM…),
//   active quand WOW_AI_URL et WOW_AI_MODEL sont définis ;
// - « anthropic » : Claude, par l'API Messages d'Anthropic, active quand WOW_AI_API_KEY est défini.

export type AssistantProvider = "openai" | "anthropic";
export type AssistantConfig = {
  provider: AssistantProvider;
  url: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  /** `reasoning_effort` envoyé à l'API compatible OpenAI ; null : non envoyé, le serveur décide. */
  reasoningEffort: ReasoningEffort | null;
};

/** Un modèle local de 14 milliards de paramètres, chargé à froid, a mis 51 s à répondre (Ollama, 2026-11-06). */
const TIMEOUT_MS = 120_000;

/**
 * Valeurs de `reasoning_effort` (WOW_AI_REASONING_EFFORT). Essai réel, qwen3.5:9b sur Ollama
 * (2026-11-07) : avec sa réflexion, la réponse dépassait le contexte de 4 096 tokens ou 120 s ;
 * avec « none », réponse en 2 à 4 s.
 */
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
const isReasoningEffort = (value: string): value is ReasoningEffort => (REASONING_EFFORTS as readonly string[]).includes(value);

export function assistantConfig(env: Record<string, string | undefined> = process.env): AssistantConfig | null {
  const provider = env.WOW_AI_PROVIDER?.trim().toLowerCase() || "openai";
  const apiKey = env.WOW_AI_API_KEY?.trim() || null;
  let url = env.WOW_AI_URL?.trim();
  let model = env.WOW_AI_MODEL?.trim();
  const effort = env.WOW_AI_REASONING_EFFORT?.trim().toLowerCase() || null;
  // Une valeur inconnue désactive l'assistant, comme un fournisseur inconnu : rien n'est deviné.
  if (effort !== null && !isReasoningEffort(effort)) return null;
  if (provider === "anthropic") {
    if (!apiKey) return null;
    url ||= ANTHROPIC_URL;
    model ||= ANTHROPIC_MODEL;
  } else if (provider !== "openai") {
    return null;
  }
  if (!url || !model) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  // Claude règle sa réflexion lui-même (assistant-claude.ts) : la valeur ne sert qu'à l'API compatible OpenAI.
  const reasoningEffort = provider === "openai" ? effort : null;
  return { provider, url: url.replace(/\/+$/, ""), model, apiKey, timeoutMs: TIMEOUT_MS, reasoningEffort };
}

export const MAX_QUESTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 4_000;
/** Petits entiers toujours admis : énumérations (« 3 crafts »), numéros de liste. */
const FREE_INTEGER_MAX = 10;

/** Nombres d'un texte, zéros de tête retirés ; « 12 345 » (espace fine ou insécable de milliers) compte pour un seul. */
function numbersIn(text: string): string[] {
  const grouped = text.replace(/(\d)[   ](?=\d{3}\b)/g, "$1");
  return (grouped.match(/\d+/g) ?? []).map((token) => token.replace(/^0+(?=\d)/, ""));
}

/** Toutes les écritures possibles des nombres des faits : brute, en pièces, en pourcentage. */
export function allowedNumbers(facts: unknown): Set<string> {
  const allowed = new Set<string>();
  const addText = (text: string) => {
    for (const token of numbersIn(text)) allowed.add(token);
  };
  const visit = (value: unknown) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      addText(String(value));
      addText(formatCopperShort(value));
      const coins = Math.abs(Math.round(value));
      addText(`${Math.floor(coins / 10_000)} ${Math.floor((coins % 10_000) / 100)} ${coins % 100}`);
      addText(String(Math.round(value * 100)));
      addText((value * 100).toFixed(1));
      addText(String(Math.round(value / 3600)));
      addText(String(Math.round(value / 60)));
    } else if (typeof value === "string") {
      addText(value);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  visit(facts);
  return allowed;
}

/** Nombres de la réponse absents des sources (faits et question). Vide : réponse fondée. */
export function ungroundedNumbers(answer: string, sources: unknown): string[] {
  const allowed = allowedNumbers(sources);
  const unknown = new Set<string>();
  for (const value of numbersIn(answer)) {
    if (Number(value) <= FREE_INTEGER_MAX || allowed.has(value)) continue;
    unknown.add(value);
  }
  return [...unknown];
}

export type AssistantAnswer = { ok: true; answer: string } | { ok: false; error: string };

export async function askAssistant(
  config: AssistantConfig,
  facts: EconomyFacts,
  question: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AssistantAnswer> {
  const system = [
    "Tu expliques les recommandations d'un moteur économique World of Warcraft, en français, en quelques phrases.",
    "Tu ne calcules rien : tu cites et reformules uniquement les faits JSON fournis.",
    ...facts.rules,
  ].join("\n");
  const user = `Faits :\n${JSON.stringify(facts)}\n\nQuestion : ${question}`;
  const completion =
    config.provider === "anthropic" ? await completeWithClaude(config, system, user, fetchImpl) : await completeChat(config, system, user, fetchImpl);
  if (!completion.ok) return completion;
  const answer = completion.text.trim().slice(0, MAX_ANSWER_LENGTH);
  if (answer === "") return { ok: false, error: "Réponse de l'assistant illisible." };
  const unknown = ungroundedNumbers(answer, { facts, question });
  if (unknown.length > 0) {
    return { ok: false, error: `Réponse refusée : elle cite des valeurs absentes des faits du moteur (${unknown.slice(0, 5).join(", ")}).` };
  }
  return { ok: true, answer };
}

/**
 * Sonde du serveur local : allumé, il liste ses modèles en moins de 200 ms (Ollama sur le réseau
 * local, 2026-11-08). Les 3 s couvrent une machine occupée.
 */
const PROBE_TIMEOUT_MS = 3_000;

const UNREACHABLE =
  "Serveur de l'assistant injoignable : la machine qui l'héberge est sans doute éteinte, ou son service arrêté. Réessayez une fois qu'elle est démarrée.";
const CONNECTION_CUT = "Connexion au serveur de l'assistant coupée pendant la réponse : la machine qui l'héberge s'est peut-être éteinte.";

// Codes vus dans la cause d'un fetch en échec (undici). Machine éteinte : EHOSTUNREACH sous Linux,
// UND_ERR_CONNECT_TIMEOUT après 10 s sous Windows ou derrière un pare-feu qui ignore la connexion.
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "EHOSTUNREACH", "EHOSTDOWN", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENOTFOUND", "EAI_AGAIN"]);
const CUT_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

/** Codes d'erreur réseau d'un fetch en échec, y compris ceux d'une AggregateError (plusieurs adresses essayées). */
function networkCodes(error: unknown): string[] {
  const cause = (error as { cause?: { code?: unknown; errors?: { code?: unknown }[] } } | null)?.cause;
  const codes = [cause?.code, ...(Array.isArray(cause?.errors) ? cause.errors.map((entry) => entry?.code) : [])];
  return codes.filter((code): code is string => typeof code === "string");
}

const isTimeout = (error: unknown) => error instanceof Error && error.name === "TimeoutError";

/** Message d'une requête qui n'a reçu aucune réponse HTTP. */
function failureMessage(error: unknown, timeoutMs: number): string {
  const codes = networkCodes(error);
  if (codes.some((code) => UNREACHABLE_CODES.has(code))) return UNREACHABLE;
  if (codes.some((code) => CUT_CODES.has(code))) return CONNECTION_CUT;
  if (isTimeout(error)) return `L'assistant n'a pas répondu en ${Math.round(timeoutMs / 1000)} s.`;
  return "L'assistant ne répond pas.";
}

export type AssistantStatus = { up: true } | { up: false; error: string };

/**
 * Le serveur de l'API compatible OpenAI répond-il ? Toute réponse HTTP compte : seule une machine
 * injoignable rend l'assistant indisponible. Claude, service public, n'est pas sondé.
 */
export async function probeAssistant(config: AssistantConfig, fetchImpl: typeof fetch = fetch): Promise<AssistantStatus> {
  if (config.provider === "anthropic") return { up: true };
  try {
    const response = await fetchImpl(`${config.url}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return { up: true };
  } catch (error) {
    // Rien en 3 s : aucune machine ne répond à cette adresse.
    return { up: false, error: isTimeout(error) ? UNREACHABLE : failureMessage(error, PROBE_TIMEOUT_MS) };
  }
}

/** API « chat completions » compatible OpenAI. */
async function completeChat(config: AssistantConfig, system: string, user: string, fetchImpl: typeof fetch): Promise<Completion> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error, config.timeoutMs) };
  }
  if (!response.ok) return { ok: false, error: `L'assistant a refusé la demande (HTTP ${response.status}).` };
  const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null;
  const choice = body?.choices?.[0];
  // Le serveur a coupé la réponse : contexte plein, souvent rempli par la réflexion du modèle.
  if (choice?.finish_reason === "length") {
    return {
      ok: false,
      error: "Réponse coupée : le contexte du modèle est plein. Agrandissez-le sur le serveur, ou réduisez sa réflexion (WOW_AI_REASONING_EFFORT=none).",
    };
  }
  const content = choice?.message?.content;
  if (typeof content !== "string") return { ok: false, error: "Réponse de l'assistant illisible." };
  return { ok: true, text: content };
}
