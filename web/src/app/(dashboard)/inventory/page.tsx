import type { Metadata } from "next";
import { InventoryBrowser } from "@/components/inventory-browser";
import { PageHeader } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadInventory } from "@/lib/dashboard/inventory";

export const metadata: Metadata = { title: "Inventaires" };

export default async function InventoryPage() {
  await requireSession();
  const data = await loadInventory(getDatabase());

  return (
    <>
      <PageHeader art="valley" section="characters" title="Inventaires">
        Tout ce que possèdent vos personnages : sacs et banque relevés par AltBoard, courrier, ventes en cours et banques de guilde
        relevés par Baganator. Le total d&apos;un objet additionne tous les détenteurs.
      </PageHeader>
      <InventoryBrowser data={data} now={new Date().toISOString()} />
    </>
  );
}
