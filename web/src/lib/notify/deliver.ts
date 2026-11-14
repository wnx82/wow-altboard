import { payloadOf, type NotificationEvent } from "./events";

// Envoi d'un événement au webhook. Ni l'adresse ni le jeton ne sont journalisés : seuls le type
// d'événement, le statut HTTP et la durée le sont.

export const DELIVERY_TIMEOUT_MS = 10_000;

export type Delivery = { ok: true; status: number } | { ok: false; status: number | null; error: string };

export async function deliver(
  target: { url: string; token: string | null },
  event: NotificationEvent,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<Delivery> {
  const started = Date.now();
  let delivery: Delivery;
  try {
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "WoW-AltBoard",
        ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
      },
      body: JSON.stringify(payloadOf(event, now)),
      // Une redirection pourrait emporter le jeton ailleurs : refusée.
      redirect: "error",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    // Le corps de la réponse n'est pas lu au-delà du nécessaire : il est libéré aussitôt.
    await response.body?.cancel();
    delivery = response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `réponse HTTP ${response.status}` };
  } catch (error) {
    const name = (error as Error).name;
    delivery = { ok: false, status: null, error: name === "TimeoutError" ? `pas de réponse en ${DELIVERY_TIMEOUT_MS / 1000} s` : "webhook injoignable" };
  }
  console.log(
    JSON.stringify({
      event: delivery.ok ? "notify.sent" : "notify.failed",
      type: event.event,
      status: delivery.status,
      durationMs: Date.now() - started,
      ...(delivery.ok ? {} : { reason: delivery.error }),
    }),
  );
  return delivery;
}
