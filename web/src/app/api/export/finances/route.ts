import { getDatabase } from "@/db/client";
import { getSession } from "@/lib/auth/session";
import { distinctDays, financePeriod, periodStart } from "@/lib/dashboard/finances";
import { brusselsDay } from "@/lib/dashboard/gold-history";
import { listLedgerDays } from "@/lib/dashboard/queries";
import { financeSheets, viewExportFileName } from "@/lib/dashboard/view-export";
import { buildWorkbook } from "@/lib/xlsx/workbook";
import { unauthorized, xlsxResponse } from "@/lib/xlsx/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Période affichée de la page Finances (?period=7|30|90|all). Le proxy ne couvre pas /api : la
// session est vérifiée ici.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return unauthorized();

  const now = new Date();
  const period = financePeriod(new URL(request.url).searchParams.get("period") ?? undefined);
  const today = brusselsDay(now);
  const from = periodStart(period, today);
  const { rows, characters } = await listLedgerDays(getDatabase(), from);
  const workbook = buildWorkbook(financeSheets(distinctDays(rows), characters, period, from, today, now));
  console.log(JSON.stringify({ event: "export.finances", userId: session.userId, period: period.key, bytes: workbook.length }));
  return xlsxResponse(workbook, viewExportFileName("finances", now));
}
