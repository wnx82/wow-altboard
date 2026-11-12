"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

// Installation du site comme application, sur téléphone. Chrome (Android) annonce qu'elle est
// possible par l'évènement beforeinstallprompt ; le site le garde et propose l'installation dans un
// bandeau. Installée, l'application a son icône, s'ouvre en plein écran et figure parmi les
// applications du téléphone (Chrome en fait un WebAPK).
//
// Chrome n'émet cet évènement qu'après trente secondes de visite et un appui sur la page, et
// d'autres navigateurs jamais. Sans lui, le bandeau indique au bout de quelques secondes le chemin
// dans le menu du navigateur. Il passe au bouton « Installer » si l'évènement arrive ensuite.
// La page Application (components/app-install-panel.tsx) reprend tout cela sans délai ni mise en
// sourdine, avec l'état de l'appareil.

export type InstallPromptEvent = Event & {
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
/** Page d'aide à l'installation, où le bandeau n'a pas lieu d'être. */
export const INSTALL_HELP_PATH = "/application";

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

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Voir readStorage.
  }
}

/** Moment où le bandeau a été tu, s'il l'est encore. */
export function snoozedAt(): number | null {
  const at = Number(readStorage(SNOOZE_KEY));
  return at > 0 && Date.now() - at < SNOOZE_MS ? at : null;
}

const snooze = () => writeStorage(SNOOZE_KEY, String(Date.now()));

/** Drapeau posé par une installation faite depuis ce navigateur. */
export const installedFlag = (): boolean => readStorage(INSTALLED_KEY) !== null;

/** Le bandeau reviendra : fin de la mise en sourdine et oubli d'une installation passée. */
export function resetInstallHints() {
  removeStorage(SNOOZE_KEY);
  removeStorage(INSTALLED_KEY);
}

/** Page ouverte dans l'application installée, et non dans un onglet du navigateur. */
export function isStandalone(): boolean {
  return (
    ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone et iPad (un iPad se présente comme un Mac tactile). */
export function isApple(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

/**
 * Téléphone ou tablette. L'écran tactile ne suffit pas à le dire : un téléphone à stylet (Galaxy à S
 * Pen) annonce un pointeur précis, d'où aussi le système déclaré par le navigateur. Ordinateur :
 * le menu du navigateur suffit, pas de bandeau.
 */
export function isHandheld(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return window.matchMedia("(pointer: coarse)").matches || data?.mobile === true || /Android|Mobile/.test(navigator.userAgent) || isApple();
}

type RelatedApps = { getInstalledRelatedApps?: () => Promise<unknown[]> };

/**
 * L'application est-elle installée sur l'appareil ? Chrome sait le dire (manifeste,
 * related_applications) ; null quand le navigateur ne le peut pas.
 */
export async function installedOnDevice(): Promise<boolean | null> {
  const nav = navigator as Navigator & RelatedApps;
  if (typeof nav.getInstalledRelatedApps !== "function") return null;
  try {
    return (await nav.getInstalledRelatedApps()).length > 0;
  } catch {
    return null;
  }
}

// L'évènement peut survenir avant l'hydratation : il est écouté dès le chargement du module, et
// gardé même quand le bandeau se tait, pour le bouton de la page Application.
type InstallState = { prompt: InstallPromptEvent | null; installedNow: boolean };
const INITIAL: InstallState = { prompt: null, installedNow: false };
let current = INITIAL;
const listeners = new Set<() => void>();
const update = (next: Partial<InstallState>) => {
  current = { ...current, ...next };
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Remplace la mini-barre de Chrome par le bandeau du site, ou la tait pendant le délai.
    event.preventDefault();
    update({ prompt: event as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    writeStorage(INSTALLED_KEY, "1");
    update({ prompt: null, installedNow: true });
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Invite d'installation de Chrome en attente, et installation faite pendant cette visite. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => INITIAL,
  );
}

/** Ouvre la fenêtre d'installation de Chrome. Une invite ne sert qu'une fois, quelle que soit la réponse. */
export async function promptInstall(prompt: InstallPromptEvent): Promise<"accepted" | "dismissed"> {
  update({ prompt: null });
  await prompt.prompt();
  return (await prompt.userChoice).outcome;
}

export function AppInstall({ basePath }: { basePath: string }) {
  const { prompt } = useInstallState();
  const pathname = usePathname();
  // Téléphone dans le navigateur, bandeau ni tu ni rendu inutile par une installation.
  const [eligible, setEligible] = useState(false);
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
    if (snoozedAt() || isStandalone() || !isHandheld()) return;
    let cancelled = false;
    let timer: number | undefined;
    void (async () => {
      // Le drapeau d'installation survit à une désinstallation : quand Chrome sait dire si
      // l'application est là, sa réponse l'emporte.
      const installed = await installedOnDevice();
      if (installed === false) removeStorage(INSTALLED_KEY);
      if (cancelled || installed === true || (installed === null && installedFlag())) return;
      setEligible(true);
      timer = window.setTimeout(() => setMenuHint(isApple() ? "share" : "menu"), MENU_HINT_DELAY_MS);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (closed || !eligible || (!prompt && !menuHint) || pathname === INSTALL_HELP_PATH) return null;

  const dismiss = () => {
    snooze();
    setClosed(true);
  };

  const install = async () => {
    if (!prompt) return;
    setClosed(true);
    if ((await promptInstall(prompt)) === "dismissed") snooze();
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
        {!prompt && (
          <Link href={INSTALL_HELP_PATH} className="text-xs text-gold underline underline-offset-2" onClick={() => setClosed(true)}>
            Pas dans le menu ?
          </Link>
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
