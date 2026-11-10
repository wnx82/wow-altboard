import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { templateMatrices, type MatrixCell, type TemplateMatrix } from "@/lib/goals/matrix";
import { classKey, formatDateTime } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Objectifs" };

export default async function GoalsPage() {
  await requireSession();
  const matrices = await templateMatrices(getDatabase());

  return (
    <>
      <PageHeader section="characters" title="Objectifs">
        Chaque modèle d&apos;objectifs en tableau : ses objectifs en colonnes, les personnages qui l&apos;ont appliqué en lignes. Un modèle
        s&apos;enregistre et s&apos;applique depuis la section Objectifs de la fiche d&apos;un personnage.
      </PageHeader>

      {matrices.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun modèle d'objectifs">
            Ouvrez la fiche d&apos;un personnage, ajoutez-lui des objectifs, puis enregistrez-les comme modèle pour les appliquer aux autres.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {matrices.map((matrix) => (
            <Matrix key={matrix.id} matrix={matrix} />
          ))}
        </div>
      )}
    </>
  );
}

function Cell({ cell }: { cell: MatrixCell }) {
  if (cell === null) return <span className="text-faint">—</span>;
  if (cell.reached) {
    return (
      <span className="text-ok" title={cell.achievedAt ? `Atteint le ${formatDateTime(cell.achievedAt)}` : "Atteint"}>
        ✓<span className="sr-only"> atteint</span>
      </span>
    );
  }
  return <span className="tabular-nums text-muted">{cell.progress ?? "à faire"}</span>;
}

function Matrix({ matrix }: { matrix: TemplateMatrix }) {
  return (
    <section aria-label={matrix.name}>
      <SectionTitle aside={`${matrix.items.length} objectif${matrix.items.length > 1 ? "s" : ""} · ${matrix.rows.length} personnage${matrix.rows.length > 1 ? "s" : ""}`}>
        {matrix.name}
      </SectionTitle>
      {matrix.rows.length === 0 ? (
        <p className="panel px-5 py-4 text-sm text-muted">Aucun personnage n&apos;a encore ce modèle.</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Personnage</th>
                <th scope="col" className="num">
                  Atteints
                </th>
                {matrix.items.map((item, index) => (
                  <th key={index} scope="col" className="min-w-32 text-center">
                    {item.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row) => (
                <tr key={row.character.id} data-class={classKey(row.character.class)}>
                  <th scope="row" className="whitespace-nowrap text-left font-normal">
                    <Link href={`/characters/${row.character.id}`} prefetch={false} className="font-semibold class-text hover:underline">
                      {row.character.name}
                    </Link>
                    {row.character.level !== null && <span className="ml-2 text-xs text-muted">niv. {row.character.level}</span>}
                  </th>
                  <td className="num whitespace-nowrap tabular-nums">
                    {row.done} / {row.assigned}
                  </td>
                  {row.cells.map((cell, index) => (
                    <td key={index} className="text-center">
                      <Cell cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
