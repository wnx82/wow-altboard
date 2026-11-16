import { RateLimiter } from "@/lib/rate-limit";

type GlobalWithSyncLimiter = typeof globalThis & { __wowAltboardSyncLimiter?: RateLimiter };

/**
 * Limiteur commun aux routes de l'agent (/api/sync et /api/sync/agent) : un jeton deviné sur l'une
 * compte aussi pour l'autre. Sur globalThis, car chaque route est compilée séparément.
 */
export function syncRateLimiter(): RateLimiter {
  const holder = globalThis as GlobalWithSyncLimiter;
  holder.__wowAltboardSyncLimiter ??= new RateLimiter();
  return holder.__wowAltboardSyncLimiter;
}
