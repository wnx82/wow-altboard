import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="panel w-full max-w-sm px-7 py-9">
        <p className="eyebrow text-gold">Tableau de bord privé</p>
        <h1 className="display mt-2 text-3xl font-bold">WoW AltBoard</h1>
        <p className="mt-2 text-sm text-muted">Tous mes personnages, tous mes comptes, tous mes PC.</p>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
