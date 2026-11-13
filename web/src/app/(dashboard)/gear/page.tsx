import type { Metadata } from "next";
import { GearPlanner } from "@/components/gear-planner";
import { PageHeader } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadGearPlanner } from "@/lib/dashboard/gear-planner-data";

export const metadata: Metadata = { title: "Équipement" };

export default async function GearPage() {
  await requireSession();
  const data = await loadGearPlanner(getDatabase());

  return (
    <>
      <PageHeader art="forge" section="characters" title="Équipement">
        Choisissez une classe ou un personnage et un niveau : la page cherche dans les sacs, les banques, le courrier et les banques de guilde
        de tous vos personnages les armures et les armes qu&apos;il peut porter, et propose la meilleure pour chaque emplacement.
      </PageHeader>
      <GearPlanner data={data} now={new Date().toISOString()} />
    </>
  );
}
