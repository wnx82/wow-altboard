import type { CharacterListItem } from "./queries";

type Grouped = Pick<CharacterListItem, "account" | "moneyCopper" | "level">;

export type AccountGroup<T extends Grouped> = {
  account: T["account"];
  members: T[];
  /** Somme de l'or connu ; null si aucun personnage du bloc n'a de montant. */
  totalCopper: number | null;
  /** Niveau le plus élevé du bloc ; null si aucun niveau n'est connu. */
  topLevel: number | null;
};

/**
 * Un bloc par compte : les comptes mis en avant d'abord, puis rangés par libellé. L'ordre reçu est
 * conservé à l'intérieur de chaque bloc : le tri choisi dans la page s'y applique donc tel quel.
 */
export function groupByAccount<T extends Grouped>(characters: T[], compareLabels: (a: string, b: string) => number): AccountGroup<T>[] {
  const byAccount = new Map<number, AccountGroup<T>>();
  for (const character of characters) {
    let group = byAccount.get(character.account.id);
    if (!group) {
      group = { account: character.account, members: [], totalCopper: null, topLevel: null };
      byAccount.set(character.account.id, group);
    }
    group.members.push(character);
    if (character.moneyCopper !== null) group.totalCopper = (group.totalCopper ?? 0) + character.moneyCopper;
    if (character.level !== null) group.topLevel = Math.max(group.topLevel ?? character.level, character.level);
  }
  return [...byAccount.values()].sort(
    (a, b) =>
      Number(b.account.featured) - Number(a.account.featured) ||
      compareLabels(a.account.label, b.account.label) ||
      a.account.id - b.account.id,
  );
}
