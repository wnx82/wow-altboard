import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { buildExport, exportFileName } from "@/lib/dashboard/export";
import { unauthorized, xlsxResponse } from "@/lib/xlsx/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le proxy ne couvre pas /api : la session est vérifiée ici.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return unauthorized();

  const now = new Date();
  const workbook = await buildExport(getDatabase(), now);
  console.log(JSON.stringify({ event: "export.xlsx", userId: session.userId, bytes: workbook.length }));
  return xlsxResponse(workbook, exportFileName(now));
}
