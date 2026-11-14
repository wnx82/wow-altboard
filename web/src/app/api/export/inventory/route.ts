import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { loadInventory } from "@/lib/dashboard/inventory";
import { readInventoryState } from "@/lib/dashboard/inventory-view";
import { inventorySheets, viewExportFileName } from "@/lib/dashboard/view-export";
import { buildWorkbook } from "@/lib/xlsx/workbook";
import { unauthorized, xlsxResponse } from "@/lib/xlsx/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vue affichée de la page Inventaires : mêmes paramètres d'adresse, mêmes filtres, même tri. Le
// proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return unauthorized();

  const now = new Date();
  const state = readInventoryState(new URL(request.url).searchParams);
  const workbook = buildWorkbook(inventorySheets(await loadInventory(getDatabase(), now), state, now));
  console.log(JSON.stringify({ event: "export.inventory", userId: session.userId, bytes: workbook.length }));
  return xlsxResponse(workbook, viewExportFileName("inventaires", now));
}
