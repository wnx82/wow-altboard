import type { CharacterPayload } from "./schema";

/**
 * Identité qu'AltBoard a relevée pendant que le client ne la donnait pas encore. Vu sur WoW Forever
 * (2026-11-27) : juste après un passage de niveau, AltBoard lit l'ancien niveau, une expérience 0 / 0
 * et aucune guilde, puis ne relit plus l'identité tant que le personnage ne gagne pas d'expérience.
 * Le niveau en cours d'Allemano Ledger, écrit dans le même dossier du même PC, fait alors foi : un
 * niveau ne redescend jamais. Une expérience 0 / 0 n'est jamais réelle.
 */
export type IdentityRepair = {
  character: CharacterPayload;
  /** Guilde absente, expérience et expérience reposée de ce relevé ne sont pas fiables. */
  unreliable: boolean;
};

export function repairIdentity(character: CharacterPayload): IdentityRepair {
  const ledgerLevel = ledgerLevelOf(character);
  const behind = ledgerLevel !== null && (character.level === undefined || ledgerLevel > character.level);
  const emptyXp = character.xpMax === 0;
  if (!behind && !emptyXp) return { character, unreliable: false };

  // L'expérience relevée appartient à l'ancien niveau, ou vaut 0 / 0 : inconnue.
  const repaired: CharacterPayload = behind ? { ...character, level: ledgerLevel } : { ...character };
  delete repaired.xp;
  delete repaired.xpMax;
  return { character: repaired, unreliable: true };
}

/** Ce que le site connaît déjà du personnage, pour compléter un relevé non fiable. */
export type KnownIdentity = { level: number | null; xp: number | null; xpMax: number | null; restedXp: number | null; guild: string | null };

/**
 * Complète un relevé non fiable avec l'état déjà connu : la guilde et l'expérience reposée, et
 * l'expérience quand le niveau n'a pas changé. Une valeur présente dans le relevé est gardée.
 */
export function withKnownIdentity(character: CharacterPayload, known: KnownIdentity): CharacterPayload {
  const sameLevel = known.level !== null && known.level === character.level && known.xpMax !== null && known.xpMax > 0;
  return {
    ...character,
    ...(character.guild === undefined && known.guild !== null ? { guild: known.guild } : {}),
    ...(character.restedXp === undefined && known.restedXp !== null ? { restedXp: known.restedXp } : {}),
    ...(sameLevel && character.xp === undefined && character.xpMax === undefined && known.xp !== null
      ? { xp: known.xp, xpMax: known.xpMax! }
      : {}),
  };
}

/** Niveau atteint selon Allemano Ledger : le niveau en cours, ou celui qui suit le dernier niveau terminé. */
function ledgerLevelOf(character: CharacterPayload): number | null {
  const playtime = character.playtime;
  if (!playtime) return null;
  const reached = Math.max(playtime.current?.level ?? 0, ...playtime.levels.map((entry) => entry.level + 1));
  return reached > 0 ? reached : null;
}
