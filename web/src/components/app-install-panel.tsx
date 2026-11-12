"use client";

import { useEffect, useState } from "react";
import {
  installedFlag,
  installedOnDevice,
  isApple,
  isHandheld,
  isStandalone,
  promptInstall,
  resetInstallHints,
  snoozedAt,
  useInstallState,
} from "@/components/app-install";
import { SectionTitle } from "@/components/ui";

// Page Application : installer le site sans attendre le bandeau, et comprendre pourquoi le
// navigateur ne le propose pas. L'état est lu sur l'appareil lui-même ; « Copier » le met en texte
// pour le transmettre.

type Report = {
  standalone: boolean;
  handheld: boolean;
  apple: boolean;
  /** Vue web d'une autre application (lien ouvert depuis une messagerie, par exemple). */
  webView: boolean;
  browser: string;
  userAgent: string;
  pointer: string;
  secure: boolean;
  serviceWorker: string;
  /** Application installée selon le navigateur ; null quand il ne sait pas le dire. */
  installed: boolean | null;
  manifest: string;
  snoozedAt: number | null;
  installedFlag: boolean;
};

type BrandData = { brands?: { brand: string; version: string }[]; mobile?: boolean; platform?: string };

function browserName(): string {
  const ua = navigator.userAgent;
  const known: [RegExp, string][] = [
    [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
    [/EdgA?\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/FxiOS\/([\d.]+)/, "Firefox"],
    [/CriOS\/([\d.]+)/, "Chrome"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  const data = (navigator as Navigator & { userAgentData?: BrandData }).userAgentData;
  const brand = data?.brands?.find(({ brand }) => !/Not.?A.?Brand|Chromium/i.test(brand));
  const platform = data?.platform || (isApple() ? "iOS" : /Android/.test(ua) ? "Android" : "");
  for (const [pattern, name] of known) {
    const match = ua.match(pattern);
    if (match) return `${brand?.brand ?? name} ${match[1].split(".")[0]}${platform ? ` · ${platform}` : ""}`;
  }
  return brand ? `${brand.brand} ${brand.version}` : "inconnu";
}

async function serviceWorkerState(): Promise<string> {
  if (!("serviceWorker" in navigator)) return "non pris en charge";
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return "non inscrit";
    const state = registration.active?.state ?? registration.installing?.state ?? registration.waiting?.state ?? "sans état";
    return `${state}${navigator.serviceWorker.controller ? ", contrôle la page" : ""}`;
  } catch (error) {
    return `erreur (${error instanceof Error ? error.message : String(error)})`;
  }
}

/** Le manifeste tel que le navigateur le reçoit, cookies compris (Cloudflare Access). */
async function manifestState(): Promise<string> {
  const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
  if (!href) return "lien absent de la page";
  try {
    const response = await fetch(href, { credentials: "include", cache: "no-store", redirect: "manual" });
    if (response.type === "opaqueredirect") return "redirigé (connexion Cloudflare Access expirée ?)";
    if (!response.ok) return `erreur HTTP ${response.status}`;
    const manifest = (await response.json()) as { name?: string; icons?: unknown[] };
    return `reçu (${manifest.name ?? "sans nom"}, ${manifest.icons?.length ?? 0} icônes)`;
  } catch (error) {
    return `illisible (${error instanceof Error ? error.message : String(error)})`;
  }
}

async function readReport(): Promise<Report> {
  const [serviceWorker, installed, manifest] = await Promise.all([serviceWorkerState(), installedOnDevice(), manifestState()]);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const anyCoarse = window.matchMedia("(any-pointer: coarse)").matches;
  return {
    standalone: isStandalone(),
    handheld: isHandheld(),
    apple: isApple(),
    webView: /; wv\)/.test(navigator.userAgent),
    browser: browserName(),
    userAgent: navigator.userAgent,
    pointer: coarse ? "tactile" : anyCoarse ? "précis, tactile en second" : "précis",
    secure: window.isSecureContext,
    serviceWorker,
    installed,
    manifest,
    snoozedAt: snoozedAt(),
    installedFlag: installedFlag(),
  };
}

const yesNo = (value: boolean | null) => (value === null ? "ne sait pas le dire" : value ? "oui" : "non");
const formatDate = (at: number) => new Date(at).toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" });

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted marker:text-gold">{children}</ol>;
}

const B = ({ children }: { children: React.ReactNode }) => <strong className="text-text">{children}</strong>;

export function AppInstallPanel() {
  const { prompt, installedNow } = useInstallState();
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void readReport().then((next) => {
      if (!cancelled) setReport(next);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, installedNow]);

  const install = async () => {
    if (!prompt) return;
    const outcome = await promptInstall(prompt);
    setNotice(outcome === "accepted" ? "Installation lancée : l'icône AltBoard arrive dans vos applications." : "Installation annulée.");
    setRefresh((value) => value + 1);
  };

  const resetHints = () => {
    resetInstallHints();
    setNotice("Le bandeau d'installation reviendra à la prochaine visite.");
    setRefresh((value) => value + 1);
  };

  const lines = report && [
    ["Navigateur", report.browser],
    ["Affichage", report.standalone ? "application installée" : "onglet du navigateur"],
    ["Appareil", report.handheld ? "téléphone ou tablette" : "ordinateur"],
    ["Pointeur", report.pointer],
    ["Vue web d'une autre application", report.webView ? "oui" : "non"],
    ["Connexion sécurisée", report.secure ? "oui" : "non"],
    ["Manifeste", report.manifest],
    ["Service worker", report.serviceWorker],
    ["Invite d'installation de Chrome", prompt ? "reçue" : "pas reçue pendant cette visite"],
    ["Installée sur l'appareil", yesNo(report.installed)],
    ["Bandeau tu jusqu'au", report.snoozedAt ? formatDate(report.snoozedAt + 30 * 24 * 60 * 60 * 1000) : "non"],
    ["Installation notée par ce navigateur", report.installedFlag ? "oui" : "non"],
    ["User-Agent", report.userAgent],
  ];

  const copy = async () => {
    if (!lines) return;
    try {
      await navigator.clipboard.writeText(lines.map(([label, value]) => `${label} : ${value}`).join("\n"));
      setNotice("Diagnostic copié.");
    } catch {
      setNotice("Copie refusée par le navigateur : sélectionnez le texte à la main.");
    }
  };

  const installed = installedNow || report?.installed === true;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section aria-label="Installer">
        <SectionTitle>Installer</SectionTitle>
        <div className="panel flex flex-col gap-4 p-5">
          {!report ? (
            <p className="text-sm text-muted">Lecture de l&apos;appareil…</p>
          ) : report.standalone ? (
            <p className="text-sm text-muted">Vous êtes dans l&apos;application installée : rien de plus à faire.</p>
          ) : installed ? (
            <div>
              <p className="font-semibold text-text">AltBoard est déjà installée sur cet appareil.</p>
              <Steps>
                <li>
                  Cherchez l&apos;icône <B>AltBoard</B> dans la liste de toutes les applications (balayez vers le haut depuis l&apos;écran
                  d&apos;accueil). Android ne la pose pas toujours sur l&apos;écran d&apos;accueil.
                </li>
                <li>
                  Pour l&apos;y mettre : appui long sur l&apos;icône, puis <B>Ajouter à l&apos;écran d&apos;accueil</B>.
                </li>
                <li>
                  Dans Chrome, le menu <B>⋮</B> propose alors <B>Ouvrir dans AltBoard</B> au lieu d&apos;<B>Installer</B>.
                </li>
              </Steps>
            </div>
          ) : prompt ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="min-w-0 flex-1 text-sm text-muted">Chrome est prêt : une icône sur l&apos;écran d&apos;accueil, en plein écran, sans barre d&apos;adresse.</p>
              <button type="button" className="button" data-variant="primary" onClick={install}>
                Installer AltBoard
              </button>
            </div>
          ) : report.apple ? (
            <div>
              <p className="font-semibold text-text">Sur iPhone ou iPad, dans Safari</p>
              <Steps>
                <li>
                  Touchez <B>Partager</B> (le carré avec une flèche vers le haut).
                </li>
                <li>
                  Choisissez <B>Sur l&apos;écran d&apos;accueil</B>, puis <B>Ajouter</B>.
                </li>
              </Steps>
            </div>
          ) : report.handheld ? (
            <div>
              <p className="font-semibold text-text">Sur Android, dans Chrome</p>
              <Steps>
                <li>
                  Touchez le menu <B>⋮</B> en haut à droite.
                </li>
                <li>
                  Choisissez <B>Installer l&apos;application</B>. Selon la version de Chrome, c&apos;est <B>Ajouter à l&apos;écran d&apos;accueil</B>,
                  puis <B>Installer</B>.
                </li>
              </Steps>
              <p className="mt-4 text-sm font-semibold text-text">Ni l&apos;un ni l&apos;autre dans le menu ?</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
                <li>
                  Le menu montre <B>Ouvrir dans Chrome</B> : la page est ouverte dans une autre application (messagerie, e-mail). Touchez-le,
                  puis recommencez dans Chrome.
                </li>
                <li>
                  Le menu montre <B>Ouvrir dans AltBoard</B> : l&apos;application est déjà installée. Cherchez-la dans la liste des applications.
                </li>
                <li>Navigation privée : Chrome n&apos;y installe rien. Ouvrez le site dans un onglet normal.</li>
                <li>
                  Samsung Internet : icône <B>↓</B> dans la barre d&apos;adresse, ou menu <B>☰</B> puis <B>Ajouter la page à</B> puis{" "}
                  <B>Écran d&apos;accueil</B>.
                </li>
              </ul>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-text">Sur ordinateur, dans Chrome ou Edge</p>
              <Steps>
                <li>
                  Cliquez sur l&apos;icône d&apos;installation à droite de la barre d&apos;adresse.
                </li>
                <li>
                  Ou menu <B>⋮</B>, puis <B>Caster, enregistrer et partager</B>, puis <B>Installer la page en tant qu&apos;application</B>.
                </li>
              </Steps>
            </div>
          )}

          {report && !report.standalone && (report.snoozedAt || report.installedFlag) && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <p className="min-w-0 flex-1 text-xs text-muted">
                {report.snoozedAt ? "Le bandeau d'installation a été fermé sur ce navigateur." : "Ce navigateur a noté une installation passée."}
              </p>
              <button type="button" className="button" onClick={resetHints}>
                Réafficher le bandeau
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="text-sm text-gold">
              {notice}
            </p>
          )}
        </div>
      </section>

      <section aria-label="Diagnostic">
        <SectionTitle aside="état lu sur cet appareil">Diagnostic</SectionTitle>
        <div className="panel p-5">
          {lines ? (
            <>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                {lines.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted">{label}</dt>
                    <dd className="break-words text-text">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="button" onClick={copy}>
                  Copier le diagnostic
                </button>
                <button type="button" className="button" onClick={() => setRefresh((value) => value + 1)}>
                  Relire
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Lecture de l&apos;appareil…</p>
          )}
        </div>
      </section>
    </div>
  );
}
