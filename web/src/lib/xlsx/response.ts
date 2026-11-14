// Réponse HTTP d'un classeur XLSX : téléchargement, jamais mis en cache, jamais interprété.

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsxResponse(workbook: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(workbook), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(workbook.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const unauthorized = () => Response.json({ error: "Authentification requise." }, { status: 401, headers: { "Cache-Control": "no-store" } });
