import type { CharacterListItem } from "./queries";

type Contender = Pick<CharacterListItem, "name" | "level" | "xp" | "xpMax" | "itemLevel" | "hidden">;

/** Places du podium de l'accueil. */
export const CHAMPION_COUNT = 3;

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/** Part du niveau en cours déjà gagnée, 0 quand elle n'est pas connue. */
function levelProgress(character: Contender): number {
  if (character.xp === null || !character.xpMax) return 0;
  return Math.min(character.xp / character.xpMax, 1);
}

/**
 * Les personnages les plus hauts : niveau, puis expérience gagnée dans ce niveau, puis niveau
 * d'objet, puis nom. Un personnage sans niveau connu ou masqué dans l'addon ne monte pas sur le podium.
 */
export function pickChampions<T extends Contender>(characters: T[], count = CHAMPION_COUNT): T[] {
  return characters
    .filter((character) => character.level !== null && !character.hidden)
    .sort(
      (a, b) =>
        b.level! - a.level! ||
        levelProgress(b) - levelProgress(a) ||
        (b.itemLevel ?? -1) - (a.itemLevel ?? -1) ||
        collator.compare(a.name, b.name),
    )
    .slice(0, count);
}
