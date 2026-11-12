import type { Metadata } from "next";
import { AppInstallPanel } from "@/components/app-install-panel";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage() {
  await requireSession();

  return (
    <>
      <PageHeader art="heroesVista" section="admin" title="Application">
        AltBoard s&apos;installe comme une application, sans passer par un magasin : une icône sur l&apos;écran d&apos;accueil, en plein
        écran, sans barre d&apos;adresse. Cette page indique la marche à suivre et ce que le navigateur de cet appareil en dit.
      </PageHeader>
      <AppInstallPanel />
    </>
  );
}
