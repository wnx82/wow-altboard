import { NotFoundPanel } from "@/components/dashboard-shell";

// notFound() levé par une page du tableau de bord (personnage ou objet inconnu) : la 404 reste dans
// le tableau de bord, menu compris. Une adresse sans page passe par app/not-found.tsx.
export default function DashboardNotFound() {
  return (
    <div className="grid place-items-center py-10">
      <NotFoundPanel />
    </div>
  );
}
