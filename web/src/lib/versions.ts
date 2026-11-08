// Versions SemVer « X.Y.Z », avec une éventuelle préversion (« 0.5.0-beta.1 ») : celles de l'agent.

const SEMVER = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type Parsed = { core: [number, number, number]; prerelease: string | null };

function parse(version: string): Parsed | null {
  const match = SEMVER.exec(version.trim());
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null } : null;
}

/**
 * Négatif si `a` précède `b`, positif s'il le suit, zéro à égalité ; `null` si l'une des deux n'est
 * pas une version. Une préversion précède la version publiée ; deux préversions se comparent en
 * texte, ce qui suffit aux étiquettes de ce dépôt.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** Vrai seulement si les deux versions sont lisibles et que l'installée précède la dernière. */
export function isOutdated(installed: string | null | undefined, latest: string | null | undefined): boolean {
  if (!installed || !latest) return false;
  const order = compareVersions(installed, latest);
  return order !== null && order < 0;
}
