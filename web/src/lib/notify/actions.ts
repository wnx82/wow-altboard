"use server";

import { revalidatePath } from "next/cache";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { RateLimiter } from "@/lib/rate-limit";
import { parseEvents, parseSilentDays, parseToken, parseWebhookUrl, readNotifySettings, writeNotifySettings, type NotifySettingsInput } from "./config";
import { deliver } from "./deliver";
import { testEvent } from "./events";

// Chaque action vérifie la session elle-même : une Server Action est un point d'entrée HTTP à part
// entière, joignable sans passer par la page qui l'affiche.

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export type NotifySettingsState = { error?: string; saved?: boolean; removed?: boolean };

/**
 * Enregistre les réglages des notifications. L'adresse et le jeton ne sont jamais réaffichés : un
 * champ laissé vide garde la valeur en place. « remove » retire le webhook et son jeton.
 */
export async function saveNotifySettingsAction(_previous: NotifySettingsState, formData: FormData): Promise<NotifySettingsState> {
  const session = await requireSession();
  const db = getDatabase();
  const now = new Date();
  if (formData.get("intent") === "remove") {
    await writeNotifySettings(db, { url: null, token: null }, now);
    console.log(JSON.stringify({ event: "settings.notify.removed", userId: session.userId }));
    revalidatePath("/settings");
    return { removed: true };
  }

  const values: NotifySettingsInput = {};
  const rawUrl = field(formData, "url").slice(0, 2_000);
  if (rawUrl.trim() !== "") {
    const url = parseWebhookUrl(rawUrl);
    if (!url.ok) return { error: url.error };
    values.url = url.value;
  }
  const rawToken = field(formData, "token").slice(0, 1_000);
  if (formData.get("clearToken") === "on") values.token = null;
  else if (rawToken.trim() !== "") {
    const token = parseToken(rawToken);
    if (!token.ok) return { error: token.error };
    values.token = token.value;
  }
  const days = parseSilentDays(field(formData, "silentDays"));
  if (!days.ok) return { error: days.error };
  values.silentDays = days.value;
  values.events = parseEvents(formData.getAll("events"));

  await writeNotifySettings(db, values, now);
  // Ni l'adresse ni le jeton dans le journal : seulement ce qui a changé.
  console.log(
    JSON.stringify({
      event: "settings.notify.saved",
      userId: session.userId,
      url: values.url === undefined ? "kept" : "replaced",
      token: values.token === undefined ? "kept" : values.token === null ? "removed" : "replaced",
      events: values.events,
      silentDays: values.silentDays,
    }),
  );
  revalidatePath("/settings");
  return { saved: true };
}

export type NotifyTestState = { error?: string; status?: number };

const TEST_LIMIT = { max: 5, windowMs: 5 * 60_000 };
const testLimiter = new RateLimiter();

/** Envoie un événement d'essai au webhook enregistré ; cinq essais par tranche de cinq minutes. */
export async function sendTestNotificationAction(): Promise<NotifyTestState> {
  const session = await requireSession();
  if (!testLimiter.consume(`notify-test:${session.userId}`, TEST_LIMIT)) return { error: "Trop d'essais. Réessayez dans quelques minutes." };
  const settings = await readNotifySettings(getDatabase());
  if (settings.url === null) return { error: "Aucun webhook enregistré." };
  const result = await deliver({ url: settings.url, token: settings.token }, testEvent(), new Date());
  return result.ok ? { status: result.status } : { error: `Échec de l'envoi : ${result.error}.` };
}
