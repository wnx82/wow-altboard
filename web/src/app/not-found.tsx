import { DashboardShell, NotFoundPanel } from "@/components/dashboard-shell";
import { getSession, type Session } from "@/lib/auth/session";

// Adresse sans page : rendue hors du layout du tableau de bord, avec le vrai code 404. Avec une
// session, le cadre du tableau de bord (menu, recherche) est repris ; sans, la page reste seule.
export default async function NotFound() {
  let session: Session | null = null;
  try {
    session = await getSession();
  } catch {
    // Base indisponible : la 404 s'affiche sans le menu plutôt que de devenir une erreur.
  }
  if (session) {
    return (
      <DashboardShell email={session.email}>
        <div className="grid place-items-center py-10">
          <NotFoundPanel />
        </div>
      </DashboardShell>
    );
  }
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <NotFoundPanel />
    </main>
  );
}
