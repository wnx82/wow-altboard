import type { SyncPayload } from "./schema";

/**
 * Avance tolérée sur l'heure du serveur. Le jeu date ses données à l'écriture et l'agent les envoie
 * quelques secondes après : seule une horloge de PC déréglée dépasse cette marge.
 */
export const CLOCK_TOLERANCE_SECONDS = 3_600;

const MAX_REPORTED = 20;

/**
 * Chemins des horodatages postérieurs à l'heure du serveur plus la tolérance, vingt au plus.
 * Un `lastSeen` futur rangerait comme « en retard », donc ignorés, tous les envois suivants du
 * personnage jusqu'à cette date : le document est refusé plutôt qu'enregistré.
 */
export function futureTimestamps(payload: SyncPayload, now: Date, toleranceSeconds = CLOCK_TOLERANCE_SECONDS): string[] {
  const limit = Math.floor(now.getTime() / 1000) + toleranceSeconds;
  const found: string[] = [];
  const check = (path: string, value: number | undefined) => {
    if (value !== undefined && value > limit && found.length < MAX_REPORTED) found.push(path);
  };

  payload.accounts.forEach((account, a) => {
    account.characters.forEach((character, c) => {
      const at = `accounts.${a}.characters.${c}`;
      check(`${at}.lastSeen`, character.lastSeen);
      check(`${at}.statsAt`, character.statsAt);
      check(`${at}.bags.at`, character.bags?.at);
      check(`${at}.bank.at`, character.bank?.at);
      check(`${at}.playtime.measuredAt`, character.playtime?.measuredAt);
      check(`${at}.playtime.current.startedAt`, character.playtime?.current?.startedAt);
      character.playtime?.levels?.forEach((level, l) => check(`${at}.playtime.levels.${l}.reachedAt`, level.reachedAt));
      character.sessions?.forEach((session, s) => {
        check(`${at}.sessions.${s}.startedAt`, session.startedAt);
        check(`${at}.sessions.${s}.stoppedAt`, session.stoppedAt);
      });
    });
  });
  return found;
}
