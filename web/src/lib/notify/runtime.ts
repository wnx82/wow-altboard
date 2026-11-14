import type { Database } from "@/db/client";
import { collectEvents } from "./collect";
import { readNotifySettings, type NotifyEventKey } from "./config";
import { deliver } from "./deliver";

// Passage des notifications, chaque minute : lit les réglages, relève les événements, les envoie.
// Sans webhook, l'état avance quand même : rien du passé ne sera annoncé à l'activation.

export const NOTIFY_INTERVAL_MS = 60_000;
/** Premier passage après le démarrage : la base et le moniteur des serveurs ont le temps de s'ouvrir. */
export const FIRST_PASS_MS = 30_000;

export async function notifyPass(db: Database, now: Date, fetchImpl: typeof fetch = fetch): Promise<{ events: number; sent: number }> {
  const settings = await readNotifySettings(db);
  const wanted = new Set<NotifyEventKey>(settings.url === null ? [] : settings.events);
  const events = await collectEvents(db, settings, wanted, now);
  let sent = 0;
  // Un envoi à la fois, dans l'ordre : n8n les reçoit comme ils se sont produits.
  for (const event of events) {
    if (settings.url === null || (event.key !== "test" && !wanted.has(event.key))) continue;
    if ((await deliver({ url: settings.url, token: settings.token }, event, now, fetchImpl)).ok) sent += 1;
  }
  return { events: events.length, sent };
}

type GlobalWithNotify = typeof globalThis & { __wowAltboardNotify?: { timer: ReturnType<typeof setTimeout> | null } };

export function startNotificationRuntime(database: () => Database): void {
  // Sur globalThis : instrumentation.ts et les pages ne partagent pas l'état d'un module.
  const global = globalThis as GlobalWithNotify;
  const held = (global.__wowAltboardNotify ??= { timer: null });
  if (held.timer) return;
  const schedule = (delay: number) => {
    held.timer = setTimeout(async () => {
      // Le passage suivant n'est programmé qu'à la fin de celui-ci : jamais deux à la fois.
      try {
        await notifyPass(database(), new Date());
      } catch (error) {
        console.error(JSON.stringify({ event: "notify.pass", ok: false, error: error instanceof Error ? error.name : "unknown" }));
      }
      schedule(NOTIFY_INTERVAL_MS);
    }, delay);
    // Le minuteur ne retient pas le processus.
    held.timer.unref?.();
  };
  schedule(FIRST_PASS_MS);
}
