import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { formatDateTime } from "@/lib/wow/format";
import { GlobalSearch } from "./global-search";
import { MainNav } from "./main-nav";

// Cadre du tableau de bord : lien d'évitement, en-tête (menu, recherche, déconnexion), contenu et
// pied de page. Partagé par le layout du tableau de bord et par la page 404 de l'application, qui
// n'est pas rendue dans ce layout. Ne vérifie aucune session : l'appelant l'a déjà lue.

// Versions figées à la construction (next.config.ts). Une valeur absente n'est pas affichée : le
// commit et la version de l'agent manquent quand l'image est construite sans le dépôt.
const versions = [
  process.env.WOW_SITE_VERSION && `Site ${process.env.WOW_SITE_VERSION}`,
  process.env.WOW_BUILD_COMMIT && `commit ${process.env.WOW_BUILD_COMMIT}`,
  process.env.WOW_BUILD_TIME && `construit le ${formatDateTime(process.env.WOW_BUILD_TIME)}`,
  process.env.WOW_AGENT_VERSION && `Agent AltBoardSync ${process.env.WOW_AGENT_VERSION}`,
].filter((entry): entry is string => Boolean(entry));

export function DashboardShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-ink/75 backdrop-blur-xl">
        {/* Une seule ligne, de hauteur fixe : le sommaire des longues pages se cale dessous. */}
        <div className="mx-auto flex h-14 w-full max-w-[1500px] items-center gap-x-2 px-4 sm:gap-x-4 sm:px-6">
          {/* Sur téléphone, « WoW » cède sa place à la navigation. */}
          <Link href="/" aria-label="WoW AltBoard" className="display flex-none text-xl font-bold text-gold">
            <span className="hidden sm:inline">WoW </span>AltBoard
          </Link>
          {/* Pages groupées en listes déroulantes : l'en-tête tient sur une ligne à toutes les largeurs. */}
          <MainNav />
          <GlobalSearch basePath={process.env.WOW_BASE_PATH ?? ""} />
          <form action={logoutAction} className="flex flex-none items-center gap-3">
            <span className="hidden text-xs text-faint lg:inline">{email}</span>
            <button className="button" type="submit" aria-label="Se déconnecter" title="Se déconnecter">
              <span className="hidden md:inline">Se déconnecter</span>
              <svg
                className="md:hidden"
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </button>
          </form>
        </div>
      </header>
      {/* tabIndex -1 : atteint par « Aller au contenu », le focus y passe sans en faire un arrêt de tabulation. */}
      <main id="contenu" tabIndex={-1} className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-8 outline-none sm:px-6">
        {children}
      </main>
      <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 text-xs text-faint sm:px-6">
        Données issues des addons AltBoard, Auctionator et NaowhForever, telles qu&apos;écrites par le jeu à la dernière déconnexion ou au dernier /reload. Ce
        n&apos;est pas du temps réel. World of Warcraft et ses icônes sont la propriété de Blizzard Entertainment.
        {versions.length > 0 && <p className="mt-2 tabular-nums">{versions.join(" · ")}</p>}
      </footer>
    </div>
  );
}

/** Page introuvable : dans le tableau de bord ou seule, selon que la session est connue. */
export function NotFoundPanel() {
  return (
    <div className="panel max-w-md px-7 py-10 text-center">
      <p className="eyebrow text-gold">Erreur 404</p>
      <h1 className="display mt-2 text-2xl font-bold">Page introuvable</h1>
      <p className="mt-2 text-sm text-muted">Ce personnage ou cette page n&apos;existe pas, ou n&apos;existe plus.</p>
      <Link href="/" className="button mt-6" data-variant="primary">
        Retour aux personnages
      </Link>
    </div>
  );
}
