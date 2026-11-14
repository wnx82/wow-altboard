// Erreurs non attrapées : Next les écrit telles quelles dans le journal du serveur. Celle d'une
// requête Drizzle (DrizzleQueryError) porte dans son message, sa pile et sa propriété `params` tous
// les paramètres de la requête : adresse e-mail, empreinte de jeton, texte saisi. Ils sont masqués
// avant l'écriture ; le SQL reste, il ne contient aucune valeur. Le code applicatif, lui, journalise
// avec describeError (lib/errors.ts), qui ne reprend jamais un message.

const QUERY_PREFIX = "Failed query: ";
const PARAMS = /\nparams: [\s\S]*$/;
export const MASKED_PARAMS = "[paramètres masqués]";

/** Masque, sur place, les paramètres d'une erreur de requête et de ses causes. Rend la même valeur. */
export function redactQueryError<T>(value: T): T {
  let current: unknown = value;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const error = current as Error & { params?: unknown };
    if (error.message.startsWith(QUERY_PREFIX) && PARAMS.test(error.message)) {
      const masked = error.message.replace(PARAMS, `\nparams: ${MASKED_PARAMS}`);
      // La pile commence par le message : elle le répète en entier.
      if (typeof error.stack === "string") error.stack = error.stack.replace(error.message, masked);
      error.message = masked;
      if ("params" in error) error.params = MASKED_PARAMS;
    }
    current = error.cause;
  }
  return value;
}

type GlobalWithRedaction = typeof globalThis & { __wowAltboardLogRedaction?: true };

/** Filtre console.error et console.warn du processus serveur ; un second appel ne fait rien. */
export function installLogRedaction(target: Pick<Console, "error" | "warn"> = console): void {
  const global = globalThis as GlobalWithRedaction;
  if (target === console) {
    if (global.__wowAltboardLogRedaction) return;
    global.__wowAltboardLogRedaction = true;
  }
  for (const method of ["error", "warn"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(...args.map(redactQueryError));
  }
}
