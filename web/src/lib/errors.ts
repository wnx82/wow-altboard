// Ce qu'une erreur peut dire dans un journal ou dans sync_errors : son type et ses codes, jamais son
// message. Celui d'une requête Drizzle contient le SQL et tous ses paramètres ; celui de PostgreSQL
// peut citer une valeur reçue (« invalid input syntax for type integer: "…" ») ; ceux de JavaScript
// aussi (« Cannot convert … to a BigInt »). Voir docs/SECURITY.md.

const SQLSTATE = /^[0-9A-Z]{5}$/;
const NETWORK = /^E[A-Z_]{2,30}$|^UND_ERR_[A-Z_]{1,40}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

type Codes = { code?: unknown; constraint?: unknown; errors?: unknown };

/** Type de l'erreur, puis le code SQLSTATE ou réseau trouvé dans ses causes, et la contrainte violée. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "erreur inconnue";
  // DrizzleQueryError garde le nom « Error » : sa classe le dit mieux.
  const parts = [error.name && error.name !== "Error" ? error.name : error.constructor.name || "Error"];

  // Drizzle enveloppe l'erreur de pg dans `cause` ; une connexion refusée peut être un AggregateError.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const { code, constraint, errors } = current as Codes;
    if (typeof code === "string" && (SQLSTATE.test(code) || NETWORK.test(code))) {
      parts.push(code);
      if (typeof constraint === "string" && IDENTIFIER.test(constraint)) parts.push(`(${constraint})`);
      break;
    }
    current = current.cause ?? (Array.isArray(errors) ? errors[0] : undefined);
  }
  return parts.join(" ");
}
