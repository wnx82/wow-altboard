import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { MAX_MATCHES, parseItemQuery, searchItemOwners, type Holding } from "@/lib/dashboard/item-search";
import { classKey, formatDateTime, formatInteger, formatRelative, QUALITY_LABELS } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Objets" };

const LOCATIONS: Record<Holding["location"], string> = { bags: "Sacs", bank: "Banque", equipped: "Porté" };

export default async function ItemsPage({ searchParams }: PageProps<"/items">) {
  await requireSession();
  const { q } = await searchParams;
  const typed = (Array.isArray(q) ? q[0] : q)?.slice(0, 80) ?? "";
  const query = parseItemQuery(typed);
  const result = query ? await searchItemOwners(getDatabase(), query) : null;
  const now = new Date();

  return (
    <>
      <p className="eyebrow text-gold">World of Warcraft</p>
      <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Objets</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Qui possède un objet, et combien : sacs, banque et équipement de tous les personnages, tels que relevés à leur dernière
        synchronisation.
      </p>

      <form className="mt-6 flex max-w-xl flex-wrap gap-2" role="search" action="">
        <input
          className="field min-w-48 flex-1"
          type="search"
          name="q"
          defaultValue={typed}
          maxLength={80}
          placeholder="Étoffe de lin, ou 2589"
          aria-label="Nom ou identifiant de l'objet"
          autoFocus={!typed}
        />
        <button className="button" data-variant="primary" type="submit">
          Rechercher
        </button>
      </form>

      <div className="mt-8">
        {typed && !query && <p className="text-sm text-muted">Tapez au moins deux lettres du nom, ou l&apos;identifiant de l&apos;objet.</p>}
        {result && result.items.length === 0 && (
          <EmptyState title="Aucun objet ne correspond">
            Seuls les objets déjà vus dans un inventaire synchronisé sont connus. Essayez une partie du nom, sans accent si besoin.
          </EmptyState>
        )}
        {result && result.items.length > 0 && (
          <>
            <p className="mb-3 text-xs text-muted" role="status">
              {result.truncated
                ? `Les ${MAX_MATCHES} premiers objets seulement : précisez la recherche.`
                : `${result.items.length} objet${result.items.length > 1 ? "s" : ""}`}
            </p>
            <ul className="space-y-4">
              {result.items.map((item) => (
                <li key={item.itemId} className="panel p-5" data-quality={item.quality ?? undefined}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-semibold">
                      <span className={item.quality === null ? undefined : "quality-text"} title={item.quality === null ? undefined : QUALITY_LABELS[item.quality]}>
                        {item.name ?? `Objet n° ${item.itemId}`}
                      </span>
                      <span className="ml-2 text-xs font-normal text-faint">n° {item.itemId}</span>
                    </h2>
                    <span className="text-sm tabular-nums text-muted">
                      {item.holdings.length === 0
                        ? "Personne n'en possède"
                        : `${formatInteger(item.total)} au total, ${item.holdings.length} détenteur${item.holdings.length > 1 ? "s" : ""}`}
                    </span>
                  </div>
                  {item.holdings.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <table className="data-table min-w-[520px]">
                        <caption className="sr-only">Détenteurs de {item.name ?? `l'objet n° ${item.itemId}`}</caption>
                        <thead>
                          <tr>
                            <th scope="col">Personnage</th>
                            <th scope="col">Où</th>
                            <th scope="col" className="num">
                              Quantité
                            </th>
                            <th scope="col">Relevé</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.holdings.map((holding, index) => (
                            <tr key={`${holding.characterId}-${holding.location}-${index}`}>
                              <th scope="row" className="font-normal">
                                <Link href={`/characters/${holding.characterId}`} className="font-semibold hover:underline" data-class={classKey(holding.characterClass)}>
                                  <span className="class-text">{holding.characterName}</span>
                                </Link>
                                <span className="ml-2 text-xs text-muted">
                                  {holding.level !== null && `Niv. ${holding.level} · `}
                                  {holding.realm}
                                </span>
                              </th>
                              <td>
                                {LOCATIONS[holding.location]}
                                {holding.variant && <span className="ml-1 text-xs text-muted">({holding.variant})</span>}
                              </td>
                              <td className="num">{formatInteger(holding.quantity)}</td>
                              <td className="whitespace-nowrap text-xs text-muted" title={holding.seenAt ? formatDateTime(holding.seenAt) : undefined}>
                                {holding.seenAt ? formatRelative(holding.seenAt, now) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
