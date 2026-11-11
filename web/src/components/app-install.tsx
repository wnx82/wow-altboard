"use client";

import { useEffect, useSyncExternalStore } from "react";

// Installation du site comme application, sur téléphone. Chrome (Android) annonce qu'elle est
// possible par l'évènement beforeinstallprompt ; le site le garde et propose l'installation dans un
// bandeau. Installée, l'application a son icône, s'ouvre en plein écran et figure parmi les
// applications du téléphone (Chrome en fait un WebAPK).

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** « Plus tard » : le bandeau se tait trente jours. */
const SNOOZE_KEY = "altboard:install-snoozed-at";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY));
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now()));
  } catch {
    // Stockage indisponible (navigation privée) : le bandeau reviendra à la prochaine visite.
  }
}

// L'évènement peut survenir avant l'hydratation : il est écouté dès le chargement du module.
let pending: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const publish = (event: InstallPromptEvent | null) => {
  pending = event;
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Remplace la mini-barre de Chrome par le bandeau du site, ou la tait pendant le délai.
    event.preventDefault();
    // Ordinateur (pointeur fin) : rien n'est proposé, le menu du navigateur suffit.
    if (snoozed() || !window.matchMedia("(pointer: coarse)").matches) return;
    publish(event as InstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => publish(null));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function AppInstall({ basePath }: { basePath: string }) {
  const prompt = useSyncExternalStore(
    subscribe,
    () => pending,
    () => null,
  );

  useEffect(() => {
    // En développement, le rechargement à chaud et un service worker font mauvais ménage.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
      // Sans service worker, le site marche comme avant : seule la page « Hors ligne » manque.
    });
  }, [basePath]);

  if (!prompt) return null;

  const install = async () => {
    // Une invite ne sert qu'une fois, quelle que soit la réponse.
    publish(null);
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "dismissed") snooze();
  };

  return (
    <aside className="install-banner" aria-label="Installer l'application">
      {/* eslint-disable-next-line @next/next/no-img-element -- icône fixe du site, sans optimiseur ni style en ligne (CSP) */}
      <img src={`${basePath}/icons/icon-192.png`} width={44} height={44} alt="" className="flex-none rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text">Installer AltBoard</p>
        <p className="text-xs text-muted">Une icône sur l&apos;écran d&apos;accueil, en plein écran, sans barre d&apos;adresse.</p>
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        <button type="button" className="button" data-variant="primary" onClick={install}>
          Installer
        </button>
        <button
          type="button"
          className="text-xs text-muted underline underline-offset-2"
          onClick={() => {
            snooze();
            publish(null);
          }}
        >
          Plus tard
        </button>
      </div>
    </aside>
  );
}
