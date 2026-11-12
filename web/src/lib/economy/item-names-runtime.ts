import type { Database } from "@/db/client";
import { importIconFiles, type IconImportResult } from "@/lib/wow/icon-files";
import { importItemNames, type ImportResult } from "./item-names";

// Noms des objets tenus à jour sans intervention : la table du jeu est importée de wago.tools peu
// après le démarrage du serveur, puis une fois par jour, et seulement quand une nouvelle version du
// client est publiée. Le bouton de la page Paramètres reste disponible pour forcer un import.
// Les noms des icônes suivent, de la même version et au même rythme.

/** Premier contrôle une minute après le démarrage : le serveur répond d'abord aux pages. */
export const FIRST_CHECK_MS = 60_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

export type ImportTrigger = "start" | "daily" | "manual";

type Holder = { running: Promise<ImportResult> | null; icons: Promise<IconImportResult> | null; timer: ReturnType<typeof setTimeout> | null };
type GlobalWithItemNames = typeof globalThis & { __wowAltboardItemNames?: Holder };

// Sur globalThis : instrumentation.ts et les actions sont compilées séparément, elles ne partagent
// pas l'état d'un module. Un seul import doit tourner par processus.
function holder(): Holder {
  const global = globalThis as GlobalWithItemNames;
  global.__wowAltboardItemNames ??= { running: null, icons: null, timer: null };
  return global.__wowAltboardItemNames;
}

/**
 * Import partagé : un appel reçu pendant un import en cours attend ce même import au lieu d'en
 * lancer un second. Le résultat est consigné dans le journal du serveur.
 */
export function runItemNamesImport(
  db: Database,
  options: { trigger: ImportTrigger; onlyIfNewer: boolean; userId?: number; fetch?: typeof globalThis.fetch },
): Promise<ImportResult> {
  const held = holder();
  if (held.running) return held.running;
  const started = Date.now();
  held.running = importItemNames(db, { now: new Date(), fetch: options.fetch, onlyIfNewer: options.onlyIfNewer })
    .catch((): ImportResult => ({ ok: false, error: "Import interrompu : la base de données a refusé l'écriture." }))
    .then((result) => {
      console.log(
        JSON.stringify({
          event: "item_names.import",
          trigger: options.trigger,
          ...(options.userId === undefined ? {} : { userId: options.userId }),
          ok: result.ok,
          ms: Date.now() - started,
          ...(result.ok ? { build: result.build, count: result.count, removed: result.removed, unchanged: result.unchanged === true } : { error: result.error }),
        }),
      );
      return result;
    })
    .finally(() => {
      held.running = null;
    });
  return held.running;
}

/** Import des noms d'icônes, un seul à la fois ; le résultat est consigné dans le journal du serveur. */
export function runIconFilesImport(db: Database, options: { trigger: ImportTrigger; onlyIfNewer: boolean; fetch?: typeof globalThis.fetch }): Promise<IconImportResult> {
  const held = holder();
  if (held.icons) return held.icons;
  const started = Date.now();
  held.icons = importIconFiles(db, { now: new Date(), fetch: options.fetch, onlyIfNewer: options.onlyIfNewer })
    .catch((): IconImportResult => ({ ok: false, error: "Import interrompu : la base de données a refusé l'écriture." }))
    .then((result) => {
      console.log(
        JSON.stringify({
          event: "icon_files.import",
          trigger: options.trigger,
          ok: result.ok,
          ms: Date.now() - started,
          ...(result.ok ? { build: result.build, count: result.count, removed: result.removed, unchanged: result.unchanged === true } : { error: result.error }),
        }),
      );
      return result;
    })
    .finally(() => {
      held.icons = null;
    });
  return held.icons;
}

/** Contrôle au démarrage puis quotidien ; un second appel ne programme rien de plus. */
export function startItemNamesRuntime(database: () => Database): void {
  const held = holder();
  if (held.timer) return;
  const schedule = (delay: number, trigger: ImportTrigger) => {
    held.timer = setTimeout(() => {
      void runItemNamesImport(database(), { trigger, onlyIfNewer: true })
        .catch(() => undefined)
        .then(() => runIconFilesImport(database(), { trigger, onlyIfNewer: true }))
        .catch(() => undefined);
      schedule(CHECK_INTERVAL_MS, "daily");
    }, delay);
    // Le minuteur ne retient pas le processus : un arrêt du serveur n'attend pas le prochain contrôle.
    held.timer.unref?.();
  };
  schedule(FIRST_CHECK_MS, "start");
}
