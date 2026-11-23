import { PLAYER_TIME_ZONE } from "@/lib/wow/format";
import type { ServiceKey, StatusConfig } from "./config";
import type { ProbeResult } from "./probe";

// Du résultat des sondes au statut affiché. Module sans accès réseau ni base : il est aussi
// importé par les composants.

export type Status = "up" | "degraded" | "down" | "unknown";

/** Ce qui a été constaté. Plusieurs constats mènent au même statut, mais ne se valent pas. */
export type Outcome = "ok" | "slow" | "partial" | "refused" | "timeout" | "dns" | "network" | "error";

export type Evaluation = {
  status: Status;
  outcome: Outcome;
  latencyMs: number | null;
  targetsUp: number;
  targetsTotal: number;
  error: string | null;
};

/**
 * Statut d'un service d'après ses adresses.
 * - En ligne : toutes répondent, la plus rapide sous le seuil de latence.
 * - Dégradé : toutes répondent mais lentement, ou une partie seulement répond.
 * - Hors ligne : aucune ne répond, et au moins une a été jointe sans succès (refus ou silence).
 * - Inconnu : aucune n'a pu être jointe (DNS, réseau de ce serveur) : son état n'est pas établi.
 */
export function evaluateService(results: ProbeResult[], degradedMs: number): Evaluation {
  const connected = results.filter((result) => result.outcome === "connected");
  const base = { targetsUp: connected.length, targetsTotal: results.length };

  if (connected.length > 0) {
    const latencies = connected.map((result) => result.latencyMs).filter((latency): latency is number => latency !== null);
    const latencyMs = latencies.length > 0 ? Math.min(...latencies) : null;
    if (connected.length < results.length) {
      const failed = results.find((result) => result.outcome !== "connected");
      return { ...base, status: "degraded", outcome: "partial", latencyMs, error: failed?.error ?? null };
    }
    if (latencyMs !== null && latencyMs >= degradedMs) return { ...base, status: "degraded", outcome: "slow", latencyMs, error: null };
    return { ...base, status: "up", outcome: "ok", latencyMs, error: null };
  }

  // Le refus prime : c'est la seule panne que le serveur visé confirme lui-même.
  for (const outcome of ["refused", "timeout"] as const) {
    const found = results.find((result) => result.outcome === outcome);
    if (found) return { ...base, status: "down", outcome, latencyMs: null, error: found.error };
  }
  for (const outcome of ["dns", "network"] as const) {
    const found = results.find((result) => result.outcome === outcome);
    if (found) return { ...base, status: "unknown", outcome, latencyMs: null, error: found.error };
  }
  return { ...base, status: "unknown", outcome: "error", latencyMs: null, error: results[0]?.error ?? null };
}

/** Libellé d'un service. Les serveurs de jeu portent l'environnement surveillé (« EU », « Bêta »). */
export function serviceLabel(service: ServiceKey, label: string): string {
  return service === "auth" ? "Authentification Blizzard" : `Serveurs de jeu ${label}`;
}

export const STATUS_LABELS: Record<Status, string> = {
  up: "En ligne",
  degraded: "Dégradé",
  down: "Hors ligne",
  unknown: "Inconnu",
};

/** Ton du badge (voir globals.css). « Inconnu » garde le badge neutre. */
export const STATUS_TONES: Record<Status, "ok" | "warn" | "danger" | undefined> = {
  up: "ok",
  degraded: "warn",
  down: "danger",
  unknown: undefined,
};

export const STATUS_HELP: Record<Status, string> = {
  up: "Toutes les adresses surveillées acceptent la connexion, sous le seuil de latence.",
  degraded: "Le service répond, mais lentement, ou une partie seulement de ses adresses répond.",
  down: "Aucune adresse ne répond : connexion refusée, ou aucune réponse dans le délai.",
  unknown: "État non établi : aucune adresse configurée, aucun contrôle récent, ou serveur jamais joint (DNS, réseau).",
};

export function isStatus(value: string): value is Status {
  return value in STATUS_LABELS;
}

const checkTime = new Intl.DateTimeFormat("fr-BE", { dateStyle: "short", timeStyle: "medium", timeZone: PLAYER_TIME_ZONE });

/** Date et heure d'un contrôle, à la seconde, en heure de Bruxelles. */
export function formatCheckTime(date: Date | string | null): string {
  return date === null ? "—" : checkTime.format(new Date(date));
}

const milliseconds = new Intl.NumberFormat("fr-FR");

export function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? "—" : `${milliseconds.format(latencyMs)} ms`;
}

/** Rythme des contrôles, en minutes quand l'intervalle en compte un nombre entier. */
export function formatEvery(seconds: number): string {
  if (seconds === 60) return "chaque minute";
  return seconds % 60 === 0 ? `toutes les ${seconds / 60} minutes` : `toutes les ${seconds} secondes`;
}

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;

/** Phrase qui dit ce qui a été constaté, là où le statut seul ne le dit pas. */
export function describeOutcome(
  check: { outcome: string; latencyMs: number | null; targetsUp: number; targetsTotal: number; error: string | null },
  config: Pick<StatusConfig, "timeoutMs" | "degradedMs">,
): string {
  switch (check.outcome) {
    case "ok":
      return check.targetsTotal > 1 ? `${check.targetsTotal} adresses sur ${check.targetsTotal} répondent` : "Connexion acceptée";
    case "slow":
      return `Connexion acceptée en ${formatLatency(check.latencyMs)}, au-delà du seuil de ${formatLatency(config.degradedMs)}`;
    case "partial":
      return `${plural(check.targetsUp, "adresse")} sur ${check.targetsTotal} ${check.targetsUp > 1 ? "répondent" : "répond"}`;
    case "refused":
      return "Connexion refusée : panne confirmée par le serveur visé";
    case "timeout":
      return `Aucune réponse en ${milliseconds.format(config.timeoutMs / 1000)} s : panne probable, non confirmée`;
    case "dns":
      return "Nom d'hôte introuvable (DNS) : le serveur n'a pas été joint";
    case "network":
      return "Réseau injoignable depuis ce serveur : le serveur visé n'a pas été joint";
    default:
      // Code posé par guard.ts : l'adresse saisie dans Paramètres ne désigne pas un serveur public.
      if (check.error === "EBLOCKED") return "Adresse refusée : elle ne désigne pas un serveur public, rien n'a été sondé";
      return check.error ? `Erreur réseau (${check.error})` : "Erreur réseau";
  }
}
