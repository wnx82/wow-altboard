import Link from "next/link";
import { Confidence, Holders, ItemName, Reasons } from "@/components/economy";
import { ScrollRegion } from "@/components/scroll-region";
import { Money } from "@/components/ui";
import { DECISION_LABELS, type CraftDecision } from "@/lib/economy/craft";
import type { CraftRow } from "@/lib/economy/craft-view";
import type { EconomyContext } from "@/lib/economy/load";
import { STOCK_LABELS, type StockStatus } from "@/lib/economy/stock-view";
import { formatPercent } from "@/lib/economy/view";
import { classKey, formatInteger } from "@/lib/wow/format";

// Tableau des recettes d'un métier sur la page Craft : produit, composants en stock, décision et chiffres.

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

export type RecipeRow = CraftRow & { stock: StockStatus };

export function RecipeTable({
  rows,
  caption,
  context,
  itemQuery,
}: {
  rows: readonly RecipeRow[];
  caption: string;
  context: Pick<EconomyContext, "names" | "holdings">;
  itemQuery: string;
}) {
  return (
    <ScrollRegion className="overflow-x-auto" label={caption}>
      <table className="data-table min-w-[1240px]">
        <caption className="sr-only">{caption}</caption>
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
              <th scope="row" className="min-w-[10rem] sm:min-w-[14rem]">
                <ItemName itemKey={craft.outputKey} names={context.names} query={itemQuery} />
                {craft.outputQuantity > 1 && <span className="text-muted"> × {craft.outputQuantity}</span>}
                <div className="mt-0.5 text-xs text-muted">
                  {recipe.characters.map((character, index) => (
                    <span key={character.id} data-class={classKey(character.class)}>
                      {index > 0 && ", "}
                      <Link href={`/characters/${character.id}`} prefetch={false} className="class-text hover:underline">
                        {character.name}
                      </Link>
                    </span>
                  ))}
                </div>
              </th>
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
    </ScrollRegion>
  );
}
