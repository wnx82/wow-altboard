import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="login-stage grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          {/* Blason : écu et épée, l'emblème du site. Décoratif. */}
          <span className="page-sigil grid" data-size="lg" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10v-6Z" />
              <path d="M12 6.5v10M9.5 9h5M10.5 16.5h3" />
            </svg>
          </span>
          <h1 className="display mt-5 text-3xl font-bold text-gold sm:text-4xl">WoW AltBoard</h1>
          <p className="mt-2 text-sm text-muted">Tous mes personnages, tous mes comptes, tous mes PC.</p>
        </div>
        <div className="panel mt-8 px-7 py-8">
          <p className="page-eyebrow">Tableau de bord privé</p>
          <LoginForm next={typeof next === "string" ? next : "/"} />
        </div>
      </div>
    </main>
  );
}
