import type { Metadata } from "next";
import Link from "next/link";
import { Confidence, Holders, ItemName, MarketSelector, MarketSource, Reasons } from "@/components/economy";
import { EmptyState, Money, PageHeader, ProfessionIcon, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DECISION_LABELS, type CraftDecision } from "@/lib/economy/craft";
import { DECISION_ORDER, sortCrafts, summarizeProfessions } from "@/lib/economy/craft-view";
import { loadEconomy } from "@/lib/economy/load";
import { craftableNow, STOCK_LABELS, stockStatus, type StockStatus } from "@/lib/economy/stock-view";
import { formatDay, formatPercent, marketParam, marketQuery } from "@/lib/economy/view";
import { classKey, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Craft" };

const DECISION_TONES: Record<CraftDecision, "ok" | "warn" | "danger" | undefined> = {
  CRAFT: "ok",
  SELL_REAGENTS: "warn",
  WAIT: undefined,
  DONT_CRAFT: "danger",
};

const STOCK_TONES: Record<StockStatus["kind"], "ok" | "warn" | undefined> = {
  complete: "ok",
  vendor: "ok",
  partial: "warn",
  none: undefined,
};

export default async function CraftingPage({ searchParams }: PageProps<"/crafting">) {
  await requireSession();
  const params = await searchParams;
  const context = await loadEconomy(getDatabase(), { marketId: marketParam(params.market), now: new Date() });

  if (!context || context.recipes.length === 0) {
    return (
      <>
        <Header />
        <div className="mt-6">
          <EmptyState title={context ? "Aucune recette connue" : "Aucun prix reçu"}>
            {context
              ? "Les recettes viennent de l'addon NaowhForever : ouvrez la fenêtre de chaque métier en jeu, /reload, puis lancez l'agent."
              : "Les prix viennent de l'addon Auctionator : faites un scan à l'hôtel des ventes, /reload, puis lancez l'agent."}
          </EmptyState>
        </div>
      </>
    );
  }

  const decision = DECISION_ORDER.find((entry) => entry === params.decision) ?? null;
  const stockOnly = params.stock === "1";
  const bySpell = new Map(context.recipes.map((recipe) => [recipe.spellId, recipe]));
  const all = sortCrafts(context.crafts.map((craft) => ({ craft, recipe: bySpell.get(craft.spellId)! }))).map((row) => ({
    ...row,
    stock: stockStatus(row.craft.reagents),
  }));
  const inStock = all.filter((row) => craftableNow(row.stock));
  const rows = (stockOnly ? inStock : all).filter((row) => decision === null || row.craft.decision === decision);
  const counts = Object.fromEntries(DECISION_ORDER.map((entry) => [entry, all.filter((row) => row.craft.decision === entry).length])) as Record<CraftDecision, number>;
  const professionName = (skillLine: number | null) => (skillLine === null ? "Métier inconnu" : (context.professions.get(skillLine) ?? `Métier ${skillLine}`));
  const professions = summarizeProfessions(all, professionName);
  const itemQuery = marketQuery(context.market, context.markets);
  const suffix = marketQuery(context.market, context.markets, "&");
  // Filtres combinables : décision, et recettes faisables avec les stocks.
  const filterHref = (changes: { decision?: CraftDecision | null; stock?: boolean }) => {
    const nextDecision = changes.decision === undefined ? decision : changes.decision;
    const query = [nextDecision && `decision=${nextDecision}`, (changes.stock ?? stockOnly) && "stock=1"].filter(Boolean);
    return query.length === 0 ? `/crafting${itemQuery}` : `/crafting?${query.join("&")}${suffix}`;
  };

  return (
    <>
      <Header>
        Rentabilité des recettes connues de vos personnages, au prix du marché. Un composant déjà possédé est compté à ce qu&apos;il rapporterait
        vendu : il n&apos;est jamais gratuit. Commission de l&apos;hôtel des ventes : {formatPercent(context.auctionCut)}.{" "}
        <MarketSource lastImport={context.lastImport} lastDay={formatDay(context.lastImport?.lastDay ?? null)} />
      </Header>
      <MarketSelector path="/crafting" market={context.market} markets={context.markets} />

      <section aria-label="Décisions" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {DECISION_ORDER.map((entry) => (
          <StatTile key={entry} label={DECISION_LABELS[entry]} value={formatInteger(counts[entry])} hint={`recette${counts[entry] > 1 ? "s" : ""}`} />
        ))}
      </section>

      <section aria-label="Par métier" className="mt-8">
        <SectionTitle aside="lots faisables avec vos stocks">Par métier</SectionTitle>
        <div className="panel overflow-x-auto">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th scope="col">Métier</th>
                <th scope="col" className="num">
                  Recettes
                </th>
                <th scope="col" className="num">
                  À crafter
                </th>
                <th scope="col" className="num">
                  Meilleur profit
                </th>
                <th scope="col" className="num">
                  Profit des lots
                </th>
              </tr>
            </thead>
            <tbody>
              {professions.map((profession) => (
                <tr key={profession.skillLine ?? "none"}>
                  <td className="font-semibold">
                    <ProfessionIcon skillLine={profession.skillLine} size={18} /> {profession.name}
                  </td>
                  <td className="num">{profession.recipes}</td>
                  <td className="num">{profession.profitable}</td>
                  <td className="num">
                    <Money copper={profession.bestProfit === null ? null : Math.round(profession.bestProfit)} />
                  </td>
                  <td className="num">
                    <Money copper={profession.profitable === 0 ? null : Math.round(profession.batchProfit)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Recettes" className="mt-8">
        <SectionTitle aside={`${rows.length} recette${rows.length > 1 ? "s" : ""}`}>Recettes</SectionTitle>
        <nav aria-label="Décision" className="mb-3 flex flex-wrap gap-2">
          <Link href={filterHref({ decision: null })} prefetch={false} className="button" aria-current={decision === null ? "true" : undefined}>
            Toutes
          </Link>
          {DECISION_ORDER.map((entry) => (
            <Link key={entry} href={filterHref({ decision: entry })} prefetch={false} className="button" aria-current={decision === entry ? "true" : undefined}>
              {DECISION_LABELS[entry]} ({counts[entry]})
            </Link>
          ))}
          <Link
            href={filterHref({ stock: !stockOnly })}
            prefetch={false}
            className="button sm:ml-auto"
            aria-current={stockOnly ? "true" : undefined}
            title="Tous les composants en stock, ou le reste vendu par un marchand"
          >
            Faisables avec vos stocks ({inStock.length})
          </Link>
        </nav>
        {rows.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">Aucune recette dans cette catégorie.</div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[1300px]">
              <thead>
                <tr>
                  <th scope="col">Produit</th>
                  <th scope="col">Vos composants</th>
                  <th scope="col">Décision</th>
                  <th scope="col" className="num">
                    Coût
                  </th>
                  <th scope="col" className="num">
                    Produit net
                  </th>
                  <th scope="col" className="num">
                    Profit
                  </th>
                  <th scope="col" className="num">
                    ROI
                  </th>
                  <th scope="col" className="num">
                    Faisable
                  </th>
                  <th scope="col" className="num">
                    Confiance
                  </th>
                  <th scope="col">Raisons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ craft, recipe, stock }) => (
                  <tr key={craft.spellId}>
                    <td className="min-w-[14rem]">
                      <ItemName itemKey={craft.outputKey} names={context.names} query={itemQuery} />
                      {craft.outputQuantity > 1 && <span className="text-muted"> × {craft.outputQuantity}</span>}
                      <div className="mt-0.5 text-xs text-muted">
                        <ProfessionIcon skillLine={recipe.skillLine} size={14} /> {professionName(recipe.skillLine)} ·{" "}
                        {recipe.characters.map((character, index) => (
                          <span key={character.id} data-class={classKey(character.class)}>
                            {index > 0 && ", "}
                            <Link href={`/characters/${character.id}`} prefetch={false} className="class-text hover:underline">
                              {character.name}
                            </Link>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="min-w-[17rem]">
                      <span className="badge" data-tone={STOCK_TONES[stock.kind]}>
                        {STOCK_LABELS[stock.kind]}
                        {stock.kind === "complete" && ` · ${formatInteger(stock.crafts)} fois`}
                      </span>
                      <ul className="mt-1.5 space-y-1 text-xs">
                        {craft.reagents.map((reagent) => {
                          const enough = reagent.owned >= reagent.quantity;
                          const holders = context.holdings.get(reagent.itemKey) ?? [];
                          return (
                            <li key={reagent.itemKey}>
                              <span className={`tabular-nums ${enough ? "text-ok" : "text-danger"}`}>
                                <span aria-hidden="true">{enough ? "✓" : "✗"}</span> {formatInteger(reagent.owned)}/{reagent.quantity}
                              </span>
                              <span className="sr-only">{enough ? " en stock" : " manquant"}</span>{" "}
                              <ItemName itemKey={reagent.itemKey} names={context.names} query={itemQuery} />
                              {reagent.source === "marchand" && <span className="text-faint"> · marchand</span>}
                              {holders.length > 0 && (
                                <div className="mt-0.5 pl-4 text-muted">
                                  <Holders holdings={holders} limit={2} />
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td>
                      <span className="badge" data-tone={DECISION_TONES[craft.decision]}>
                        {DECISION_LABELS[craft.decision]}
                      </span>
                    </td>
                    <td className="num">
                      <Money copper={craft.costMarket === null ? null : Math.round(craft.costMarket)} />
                    </td>
                    <td className="num">
                      <Money copper={craft.outputNet === null ? null : Math.round(craft.outputNet)} />
                    </td>
                    <td className="num">
                      <Money copper={craft.profit === null ? null : Math.round(craft.profit)} />
                      {craft.profitPrudent !== null && craft.profit !== null && craft.profitPrudent !== craft.profit && (
                        <div className="text-xs text-muted" title="Au plus cher du prix de marché et du dernier prix vu">
                          prudent <Money copper={Math.round(craft.profitPrudent)} />
                        </div>
                      )}
                    </td>
                    <td className="num">{formatPercent(craft.roi)}</td>
                    <td className="num" title="Fabrications possibles avec les stocks, composants de marchand achetés">
                      {formatInteger(craft.craftableWithVendor)}
                    </td>
                    <td className="num">
                      <Confidence value={craft.confidence} />
                    </td>
                    <td className="max-w-[22rem]">
                      <Reasons codes={craft.reasons} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Crafter : profit positif au prix de marché et au prix prudent, ROI d&apos;au moins 10 %, confiance d&apos;au moins 35. Vendre les compos :
          les composants possédés rapportent plus vendus que le produit. Attendre : prix inconnu, confiance ou marge insuffisante. Vos
          composants : sacs et banques de tous vos personnages, au dernier relevé ; un composant détenu par un autre personnage que
          l&apos;artisan doit lui être envoyé. Les noms viennent des inventaires relevés par AltBoard, sinon de la table des objets du jeu.
        </p>
      </section>
    </>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <PageHeader art="forge" section="economy" title="Craft">
      {children}
    </PageHeader>
  );
}
