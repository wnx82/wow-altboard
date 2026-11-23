import { eq } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import { appSettings } from "@/db/schema";

// Réglages des notifications sortantes (page Paramètres) : webhook, jeton, événements envoyés et
// délai au-delà duquel un PC muet est signalé. Rangés dans la ligne des réglages du site.

export const NOTIFY_EVENTS = ["level", "goal", "server", "silent", "price", "weekly"] as const;
export type NotifyEventKey = (typeof NOTIFY_EVENTS)[number];

export const NOTIFY_EVENT_LABELS: Record<NotifyEventKey, string> = {
  level: "Niveau gagné",
  goal: "Objectif atteint",
  server: "Serveur de jeu de nouveau en ligne",
  silent: "PC muet depuis plusieurs jours",
  price: "Alerte de prix déclenchée",
  weekly: "Rapport hebdomadaire (lundi matin)",
};

export const DEFAULT_SILENT_DAYS = 3;
export const MAX_SILENT_DAYS = 60;
export const MAX_URL_LENGTH = 500;
export const MAX_TOKEN_LENGTH = 200;

export type NotifySettings = {
  /** Null : aucune notification n'est envoyée. */
  url: string | null;
  token: string | null;
  events: NotifyEventKey[];
  silentDays: number;
};

export const isEventKey = (value: unknown): value is NotifyEventKey => typeof value === "string" && (NOTIFY_EVENTS as readonly string[]).includes(value);

export async function readNotifySettings(db: DatabaseOrTransaction): Promise<NotifySettings> {
  const [row] = await db
    .select({
      url: appSettings.notifyWebhookUrl,
      token: appSettings.notifyWebhookToken,
      events: appSettings.notifyEvents,
      silentDays: appSettings.notifySilentDays,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  return {
    url: row?.url ?? null,
    token: row?.token ?? null,
    // Null : tous les événements ; une liste enregistrée ne garde que les clés connues.
    events: row?.events == null ? [...NOTIFY_EVENTS] : NOTIFY_EVENTS.filter((key) => row.events!.includes(key)),
    silentDays: row?.silentDays ?? DEFAULT_SILENT_DAYS,
  };
}

export type NotifySettingsInput = { url?: string | null; token?: string | null; events?: NotifyEventKey[]; silentDays?: number };

/** Écrit les réglages fournis ; les autres gardent leur valeur. */
export async function writeNotifySettings(db: DatabaseOrTransaction, values: NotifySettingsInput, now: Date): Promise<void> {
  const set = {
    ...(values.url !== undefined ? { notifyWebhookUrl: values.url } : {}),
    ...(values.token !== undefined ? { notifyWebhookToken: values.token } : {}),
    ...(values.events !== undefined ? { notifyEvents: values.events } : {}),
    ...(values.silentDays !== undefined ? { notifySilentDays: values.silentDays } : {}),
    updatedAt: now,
  };
  await db
    .insert(appSettings)
    .values({ id: 1, ...set })
    .onConflictDoUpdate({ target: appSettings.id, set });
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Adresse du webhook : http ou https, sans identifiants ni fragment. Une adresse privée est
 * admise : n8n tourne souvent sur le réseau local. Vide : null, plus aucune notification.
 */
export function parseWebhookUrl(raw: string): Parsed<string | null> {
  const value = raw.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > MAX_URL_LENGTH || /\s/.test(value)) return { ok: false, error: `Adresse invalide (${MAX_URL_LENGTH} caractères au plus, sans espace).` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Adresse invalide : la forme attendue est https://hôte/chemin." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "Seules les adresses http et https sont acceptées." };
  if (url.username !== "" || url.password !== "") return { ok: false, error: "Pas d'identifiants dans l'adresse : utilisez le jeton." };
  if (url.hash !== "") return { ok: false, error: "Pas de fragment (#…) dans l'adresse." };
  return { ok: true, value: url.toString() };
}

/** Jeton : caractères visibles seulement (il part dans un en-tête HTTP). */
export function parseToken(raw: string): Parsed<string> {
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(value)) {
    return { ok: false, error: `Jeton invalide : de 1 à ${MAX_TOKEN_LENGTH} caractères visibles, sans espace ni accent.` };
  }
  return { ok: true, value };
}

export function parseSilentDays(raw: string): Parsed<number> {
  const value = raw.trim();
  if (value === "") return { ok: true, value: DEFAULT_SILENT_DAYS };
  const days = Number(value);
  if (!/^\d{1,2}$/.test(value) || days < 1 || days > MAX_SILENT_DAYS) return { ok: false, error: `Délai invalide : de 1 à ${MAX_SILENT_DAYS} jours.` };
  return { ok: true, value: days };
}

export const parseEvents = (values: readonly unknown[]): NotifyEventKey[] => NOTIFY_EVENTS.filter((key) => values.includes(key));


/**
 * Adresse montrée dans la page : schéma et hôte seulement. Le chemin d'un webhook n8n tient lieu
 * de secret ; il n'est jamais réaffiché.
 */
export function maskUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return "adresse enregistrée";
  }
}
