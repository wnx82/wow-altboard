"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Installation du site comme application, sur téléphone. Chrome (Android) annonce qu'elle est
// possible par l'évènement beforeinstallprompt ; le site le garde et propose l'installation dans un
// bandeau. Installée, l'application a son icône, s'ouvre en plein écran et figure parmi les
// applications du téléphone (Chrome en fait un WebAPK).
//
// Chrome n'émet cet évènement qu'après trente secondes de visite et un appui sur la page, et
// d'autres navigateurs jamais. Sans lui, le bandeau indique au bout de quelques secondes le chemin
// dans le menu du navigateur. Il passe au bouton « Installer » si l'évènement arrive ensuite.

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** « Plus tard » ou « Compris » : le bandeau se tait trente jours. */
const SNOOZE_KEY = "altboard:install-snoozed-at";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** Posé à l'installation : le chemin dans le menu n'est plus proposé. */
const INSTALLED_KEY = "altboard:installed";
/** Délai avant d'indiquer le chemin dans le menu, faute d'invite de Chrome. */
const MENU_HINT_DELAY_MS = 8_000;

// Stockage indisponible (navigation privée) : le bandeau reviendra à la prochaine visite.
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Voir readStorage.
  }
}

function snoozed(): boolean {
  const at = Number(readStorage(SNOOZE_KEY));
  return at > 0 && Date.now() - at < SNOOZE_MS;
}

const snooze = () => writeStorage(SNOOZE_KEY, String(Date.now()));

/** Téléphone ou tablette, dans le navigateur. Ordinateur : le menu du navigateur suffit. */
function offerable(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone && window.matchMedia("(pointer: coarse)").matches;
}

/** iPhone et iPad (un iPad se présente comme un Mac tactile). */
function isApple(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
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
    if (snoozed() || !offerable()) return;
    publish(event as InstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => {
    writeStorage(INSTALLED_KEY, "1");
    publish(null);
  });
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
  // Chemin à indiquer quand Chrome ne propose rien : menu ⋮ (Android) ou bouton Partager (iPhone).
  const [menuHint, setMenuHint] = useState<"menu" | "share" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    // En développement, le rechargement à chaud et un service worker font mauvais ménage.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`${basePath}/sw.js`, { scope: `${basePath}/` }).catch(() => {
      // Sans service worker, le site marche comme avant : seule la page « Hors ligne » manque.
    });
  }, [basePath]);

  useEffect(() => {
    if (readStorage(INSTALLED_KEY) || snoozed() || !offerable()) return;
    const timer = window.setTimeout(() => setMenuHint(isApple() ? "share" : "menu"), MENU_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (closed || (!prompt && !menuHint)) return null;

  const dismiss = () => {
    snooze();
    publish(null);
    setClosed(true);
  };

  const install = async () => {
    if (!prompt) return;
    // Une invite ne sert qu'une fois, quelle que soit la réponse.
    publish(null);
    setClosed(true);
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
        {prompt ? (
          <p className="text-xs text-muted">Une icône sur l&apos;écran d&apos;accueil, en plein écran, sans barre d&apos;adresse.</p>
        ) : menuHint === "share" ? (
          <p className="text-xs text-muted">
            Touchez <strong className="text-text">Partager</strong>, puis <strong className="text-text">Sur l&apos;écran d&apos;accueil</strong>.
          </p>
        ) : (
          <p className="text-xs text-muted">
            Menu <strong className="text-text">⋮</strong> du navigateur, puis <strong className="text-text">Installer l&apos;application</strong> (ou{" "}
            <strong className="text-text">Ajouter à l&apos;écran d&apos;accueil</strong>).
          </p>
        )}
      </div>
      <div className="flex flex-none flex-col gap-1.5">
        {prompt ? (
          <>
            <button type="button" className="button" data-variant="primary" onClick={install}>
              Installer
            </button>
            <button type="button" className="text-xs text-muted underline underline-offset-2" onClick={dismiss}>
              Plus tard
            </button>
          </>
        ) : (
          <button type="button" className="button" onClick={dismiss}>
            Compris
          </button>
        )}
      </div>
    </aside>
  );
}
