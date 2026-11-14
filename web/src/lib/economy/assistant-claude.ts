import Anthropic from "@anthropic-ai/sdk";

// Assistant par Claude (WOW_AI_PROVIDER=anthropic) : API Messages d'Anthropic, SDK officiel. Même
// rôle que l'API compatible OpenAI : reformuler les faits du moteur, la réponse est vérifiée ensuite.

export type ClaudeConfig = { url: string; model: string; apiKey: string | null; timeoutMs: number };
export type Completion = { ok: true; text: string } | { ok: false; error: string };

export const ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_MODEL = "claude-opus-5-5";

/** Réflexion comprise : une réponse de quelques phrases reste loin de ce plafond. */
const MAX_TOKENS = 16_000;
/**
 * Une reprise après une panne passagère (surcharge, coupure), dans le même délai total : un essai
 * qui a épuisé le délai n'est pas repris (Cloudflare couperait la page à 100 s).
 */
const MAX_RETRIES = 1;
/**
 * Modèles qui acceptent le repli côté serveur : si leurs filtres déclinent la question, l'API la
 * repose aussitôt au modèle de repli recommandé. Les autres modèles ne reçoivent pas ce paramètre.
 */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export async function completeWithClaude(config: ClaudeConfig, system: string, user: string, fetchImpl: typeof fetch = fetch): Promise<Completion> {
  // Clé et adresse passées explicitement : le SDK ne lit alors ni ANTHROPIC_API_KEY ni ANTHROPIC_BASE_URL.
  const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.url, timeout: config.timeoutMs, maxRetries: MAX_RETRIES, fetch: fetchImpl });
  const fallback = FALLBACK_MODELS.has(config.model);
  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client.beta.messages.create(
      {
      model: config.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "medium" },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      // Délai total, reprise comprise ; le délai du client s'applique, lui, à chaque essai.
      { signal: AbortSignal.timeout(config.timeoutMs) },
    );
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionTimeoutError) {
      return { ok: false, error: `L'assistant n'a pas répondu en ${Math.round(config.timeoutMs / 1000)} s.` };
    }
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "Clé d'API Anthropic refusée." };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "Clé d'API Anthropic sans accès à ce modèle." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "Limite de l'API Anthropic atteinte. Réessayez dans quelques minutes." };
    if (error instanceof Anthropic.APIError && error.status !== undefined) return { ok: false, error: `L'assistant a refusé la demande (HTTP ${error.status}).` };
    return { ok: false, error: "L'assistant ne répond pas." };
  }
  if (message.stop_reason === "refusal") return { ok: false, error: "Claude a décliné cette question." };
  if (message.stop_reason === "max_tokens") return { ok: false, error: "Réponse de l'assistant tronquée." };
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return { ok: true, text };
}
