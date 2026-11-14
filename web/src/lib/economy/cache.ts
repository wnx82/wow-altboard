// Contexte de l'économie gardé en mémoire : six pages le recalculaient en entier à chaque affichage
// (douze requêtes, puis les statistiques de chaque objet). La clé reprend tout ce dont le calcul
// dépend et qui se lit d'une requête : dernière synchronisation, dernier import de prix, nombre de
// personnages, réglages, jour. Ce qui change sans laisser cette trace (noms et icônes importés de
// wago.tools, base de test vidée) appelle invalidateEconomyCache. Une entrée expire de toute façon
// après dix minutes.

export const ECONOMY_CACHE_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 8;

type Entry = { expires: number; value: Promise<unknown> };
type Holder = { generation: number; entries: Map<string, Entry> };
type GlobalWithEconomyCache = typeof globalThis & { __wowAltboardEconomyCache?: Holder };

// Sur globalThis : la route de synchronisation, les actions et les pages sont compilées séparément
// et ne partagent pas l'état d'un module.
function holder(): Holder {
  const global = globalThis as GlobalWithEconomyCache;
  global.__wowAltboardEconomyCache ??= { generation: 0, entries: new Map() };
  return global.__wowAltboardEconomyCache;
}

/** Oublie tous les contextes gardés : à appeler après une écriture que la clé ne voit pas. */
export function invalidateEconomyCache(): void {
  const held = holder();
  held.generation++;
  held.entries.clear();
}

/**
 * Valeur gardée sous `key`, calculée par `load` au premier appel. Deux appels simultanés partagent
 * le même calcul ; un calcul en échec n'est pas gardé.
 */
export function cachedEconomy<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const held = holder();
  const fullKey = `${held.generation}|${key}`;
  const found = held.entries.get(fullKey);
  if (found && found.expires > now) {
    // Plus récemment servie : passe en fin de file, la dernière à être évincée.
    held.entries.delete(fullKey);
    held.entries.set(fullKey, found);
    return found.value as Promise<T>;
  }
  for (const [entryKey, entry] of held.entries) if (entry.expires <= now) held.entries.delete(entryKey);
  const value = load();
  held.entries.set(fullKey, { expires: now + ECONOMY_CACHE_TTL_MS, value });
  value.catch(() => {
    if (held.entries.get(fullKey)?.value === value) held.entries.delete(fullKey);
  });
  while (held.entries.size > MAX_ENTRIES) held.entries.delete(held.entries.keys().next().value!);
  return value;
}
