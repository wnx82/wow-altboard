import type { Metadata } from "next";
import Link from "next/link";
import { MarketSelector, MarketSource } from "@/components/economy";
import { FilterForm, SelectFilter, TextFilterInput } from "@/components/filter-form";
import { EmptyState, Money, PageHeader, ProfessionIcon, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { DECISION_LABELS, type CraftDecision } from "@/lib/economy/craft";
import {
  craftFilterActive,
  craftHref,
  DECISION_ORDER,
  filterCraftRows,
  groupByProfession,
  NO_CRAFT_FILTER,
  readCraftFilter,
  sortCrafts,
  summarizeProfessions,
  type CraftFilter,
} from "@/lib/economy/craft-view";
import { itemLabel, loadEconomy } from "@/lib/economy/load";
import { craftableNow, stockStatus } from "@/lib/economy/stock-view";
import { formatDay, formatPercent, marketParam, marketQuery } from "@/lib/economy/view";
import { formatInteger } from "@/lib/wow/format";
import { RecipeTable } from "./recipe-table";

export const metadata: Metadata = { title: "Craft" };

export default async function CraftingPage({ searchParams }: PageProps<"/crafting">) {
  await requireSession();
  const params = await searchParams;
  const context = await loadEconomy(getDatabase(), { marketId: marketParam(params.market), now: new Date() });

  if (!context || context.recipes.length === 0) {
    return (
      <>
        <Header />
        <div className="mt-6">
          <EmptyState title={context ? "Aucune recette connue" : "Aucun prix reçu"} action={{ href: "/machines#instructions", label: "Instructions de synchronisation" }}>
            {context
              ? "Les recettes viennent de l'addon NaowhForever : ouvrez la fenêtre de chaque métier en jeu, /reload, puis lancez l'agent."
              : "Les prix viennent de l'addon Auctionator : faites un scan à l'hôtel des ventes, /reload, puis lancez l'agent."}
          </EmptyState>
        </div>
      </>
    );
  }

  const filter = readCraftFilter(params);
  const market = context.markets[0]?.id === context.market.id ? null : context.market.id;
  const href = (changes: Partial<CraftFilter>) => craftHref({ ...filter, ...changes }, market);
  const bySpell = new Map(context.recipes.map((recipe) => [recipe.spellId, recipe]));
  const all = sortCrafts(context.crafts.map((craft) => ({ craft, recipe: bySpell.get(craft.spellId)! }))).map((row) => ({
    ...row,
    stock: stockStatus(row.craft.reagents),
  }));
  const name = (itemKey: string) => itemLabel(context.names, itemKey);
  const craftable = (row: (typeof all)[number]) => craftableNow(row.stock);
  // Chaque compteur ignore son propre filtre : il dit combien de recettes ce choix montrerait.
  const scoped = filterCraftRows(all, { ...filter, decision: null, stock: false }, name, craftable);
  const counts = Object.fromEntries(DECISION_ORDER.map((entry) => [entry, scoped.filter((row) => row.craft.decision === entry).length])) as Record<CraftDecision, number>;
  const inStock = filterCraftRows(all, { ...filter, stock: true }, name, craftable).length;
  const rows = filterCraftRows(all, filter, name, craftable);
  const professionName = (skillLine: number | null) => (skillLine === null ? "Métier inconnu" : (context.professions.get(skillLine) ?? `Métier ${skillLine}`));
  const groups = groupByProfession(rows, professionName);
  const professionOptions = summarizeProfessions(all, professionName).map((profession) => ({
    value: profession.skillLine === null ? "none" : String(profession.skillLine),
    label: `${profession.name} (${profession.recipes})`,
  }));
  const active = craftFilterActive(filter);
  // Un filtre ouvre tous les métiers ; sans filtre, seuls ceux qui ont une recette à crafter le sont.
  const expandAll = active || groups.length === 1;
  const itemQuery = marketQuery(context.market, context.markets);
  const totals = Object.fromEntries(DECISION_ORDER.map((entry) => [entry, all.filter((row) => row.craft.decision === entry).length])) as Record<CraftDecision, number>;

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
          <StatTile key={entry} label={DECISION_LABELS[entry]} value={formatInteger(totals[entry])} hint={`recette${totals[entry] > 1 ? "s" : ""}`} />
        ))}
      </section>

      <FilterForm action="/crafting" active={false} label="Rechercher une recette">
        <TextFilterInput name="q" label="Recherche" value={filter.query} placeholder="Produit, composant ou personnage" />
        <SelectFilter
          name="profession"
          label="Métier"
          value={filter.profession === null ? "" : String(filter.profession)}
          all="Tous les métiers"
          options={professionOptions}
        />
        {filter.decision && <input type="hidden" name="decision" value={filter.decision} />}
        {filter.stock && <input type="hidden" name="stock" value="1" />}
        {market !== null && <input type="hidden" name="market" value={market} />}
      </FilterForm>

      <section aria-labelledby="recipes" className="mt-8">
        <SectionTitle aside={`${rows.length} recette${rows.length > 1 ? "s" : ""} sur ${all.length}`}>
          <span id="recipes">Recettes</span>
        </SectionTitle>
        <nav aria-label="Décision" className="mb-4 flex flex-wrap items-center gap-2">
          <Link href={href({ decision: null })} prefetch={false} scroll={false} className="button" aria-current={filter.decision === null ? "true" : undefined}>
            Toutes ({scoped.length})
          </Link>
          {DECISION_ORDER.map((entry) => (
            <Link key={entry} href={href({ decision: entry })} prefetch={false} scroll={false} className="button" aria-current={filter.decision === entry ? "true" : undefined}>
              {DECISION_LABELS[entry]} ({counts[entry]})
            </Link>
          ))}
          <Link
            href={href({ stock: !filter.stock })}
            prefetch={false}
            scroll={false}
            className="button sm:ml-auto"
            aria-current={filter.stock ? "true" : undefined}
            title="Tous les composants en stock, ou le reste vendu par un marchand"
          >
            Faisables avec vos stocks ({inStock})
          </Link>
          {active && (
            <Link href={craftHref(NO_CRAFT_FILTER, market)} prefetch={false} scroll={false} className="text-sm text-muted hover:text-gold hover:underline">
              Tout afficher
            </Link>
          )}
        </nav>

        {groups.length === 0 ? (
          <EmptyState title="Aucune recette ne correspond" action={{ href: craftHref(NO_CRAFT_FILTER, market), label: "Tout afficher" }}>
            La recherche porte sur le nom du produit, de ses composants et des personnages qui connaissent la recette.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {groups.map(({ summary, rows: members, counts: groupCounts }) => (
              <details
                key={summary.skillLine ?? "none"}
                id={`metier-${summary.skillLine ?? "inconnu"}`}
                className="panel craft-group"
                open={expandAll || groupCounts.CRAFT > 0}
              >
                <summary>
                  <ProfessionIcon skillLine={summary.skillLine} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">{summary.name}</span>
                    <span className="block text-xs text-muted">
                      {members.length} recette{members.length > 1 ? "s" : ""}
                      {groupCounts.CRAFT > 0 && (
                        <>
                          {" · "}
                          <span className="text-ok">
                            {groupCounts.CRAFT} à crafter
                          </span>
                        </>
                      )}
                      {groupCounts.SELL_REAGENTS > 0 && ` · ${groupCounts.SELL_REAGENTS} compos à vendre`}
                      {!filter.stock && members.some(craftable) && ` · ${members.filter(craftable).length} faisable${members.filter(craftable).length > 1 ? "s" : ""} avec vos stocks`}
                    </span>
                  </span>
                  <span className="flex-1" />
                  {summary.bestProfit !== null && (
                    <span className="hidden text-right text-xs text-muted sm:block">
                      meilleur profit
                      <span className="block text-sm">
                        <Money copper={Math.round(summary.bestProfit)} />
                      </span>
                    </span>
                  )}
                  {summary.profitable > 0 && summary.batchProfit > 0 && (
                    <span className="hidden text-right text-xs text-muted md:block" title="Profit cumulé des lots faisables avec vos stocks, composants de marchand achetés">
                      lots faisables
                      <span className="block text-sm">
                        <Money copper={Math.round(summary.batchProfit)} />
                      </span>
                    </span>
                  )}
                  <svg className="craft-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <RecipeTable rows={members} caption={`Recettes de ${summary.name}`} context={context} itemQuery={itemQuery} />
              </details>
            ))}
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
