import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DEFAULT_STATE, PLACE_LABELS, writeInventoryState } from "@/lib/dashboard/inventory-view";
import { loadWealth, WEALTH_PLACES } from "@/lib/dashboard/wealth";
import { classKey, formatInteger, formatMoney } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Patrimoine" };

const plural = (count: number, word: string) => `${formatInteger(count)} ${word}${count > 1 ? "s" : ""}`;
/** Montant affiché, « — » pour zéro : un endroit vide ne vaut rien. */
const amount = (copper: number) => (copper > 0 ? formatMoney(copper) : "—");

export default async function WealthPage() {
  await requireSession();
  const wealth = await loadWealth(getDatabase(), new Date());
  const { totals } = wealth;

  return (
    <>
      <PageHeader art="throne" section="economy" title="Patrimoine">
        Ce que valent vos personnages : leur or, plus ce qu&apos;ils possèdent (sacs, banque, courrier, ventes en cours) estimé à la
        valeur de marché, et les banques de guilde de chaque compte. Un objet sans prix connu compte pour rien.
      </PageHeader>

      {wealth.lines.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun personnage synchronisé">Le patrimoine apparaît après la première synchronisation de l&apos;agent.</EmptyState>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          <section aria-label="Vue générale" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label="Patrimoine" value={<Money copper={totals.total} />} hint={plural(wealth.accounts.length, "compte")} />
            <StatTile label="Or" value={<Money copper={totals.gold} />} hint={plural(wealth.lines.length, "personnage")} />
            <StatTile
              label="Objets"
              value={<Money copper={totals.items} />}
              hint={
                wealth.market
                  ? `valeur de marché, ${wealth.market.label}${totals.unpriced > 0 ? ` ; ${plural(totals.unpriced, "exemplaire")} sans prix, comptés pour rien` : ""}`
                  : "aucun prix reçu"
              }
              tone={wealth.market ? undefined : "warn"}
            />
            <StatTile
              label="Banques de guilde"
              value={<Money copper={totals.guilds} />}
              hint="or et objets"
            />
          </section>

          <section aria-label="Par compte">
            <SectionTitle>Par compte</SectionTitle>
            <div className="panel overflow-x-auto">
              <table className="data-table min-w-[640px]">
                <thead>
                  <tr>
                    <th scope="col">Compte</th>
                    <th scope="col" className="num">
                      Personnages
                    </th>
                    <th scope="col" className="num">
                      Or
                    </th>
                    <th scope="col" className="num">
                      Objets
                    </th>
                    <th scope="col" className="num">
                      Banques de guilde
                    </th>
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {wealth.accounts.map((account) => (
                    <tr key={account.account.id}>
                      <th scope="row" className="text-left font-semibold">
                        {account.account.label}
                      </th>
                      <td className="num tabular-nums">{account.characters}</td>
                      <td className="num tabular-nums">{amount(account.gold)}</td>
                      <td className="num tabular-nums">{amount(account.items)}</td>
                      <td className="num tabular-nums">{amount(account.guilds)}</td>
                      <td className="num tabular-nums font-semibold">{amount(account.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-label="Par personnage">
            <SectionTitle aside="du plus riche au moins riche">Par personnage</SectionTitle>
            <div className="panel overflow-x-auto">
              <table className="data-table min-w-[860px]">
                <thead>
                  <tr>
                    <th scope="col">Personnage</th>
                    <th scope="col" className="num">
                      Or
                    </th>
                    {WEALTH_PLACES.map((place) => (
                      <th key={place} scope="col" className="num">
                        {PLACE_LABELS[place]}
                      </th>
                    ))}
                    <th scope="col" className="num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {wealth.lines.map((line) => (
                    <tr key={line.character.id} data-class={classKey(line.character.class)}>
                      <th scope="row" className="text-left">
                        <Link href={`/characters/${line.character.id}`} prefetch={false} className="font-semibold class-text hover:underline">
                          {line.character.name}
                        </Link>
                        <span className="block text-xs font-normal text-muted">
                          {[line.character.level !== null && `Niveau ${line.character.level}`, line.character.account.label].filter(Boolean).join(" · ")}
                        </span>
                      </th>
                      <td className="num tabular-nums">{amount(line.gold)}</td>
                      {WEALTH_PLACES.map((place) => (
                        <td key={place} className="num tabular-nums">
                          {line.places[place] > 0 ? (
                            <Link
                              href={`/inventory${writeInventoryState({ ...DEFAULT_STATE, character: String(line.character.id), places: [place] })}`}
                              prefetch={false}
                              className="hover:text-gold hover:underline"
                            >
                              {formatMoney(line.places[place])}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      ))}
                      <td className="num tabular-nums font-semibold">{amount(line.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-faint">
              Sacs et banque relevés par AltBoard, courrier et ventes en cours par Baganator : un endroit jamais relevé paraît vide.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
