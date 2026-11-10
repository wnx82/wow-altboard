import type { ReagentCost } from "./craft";
import type { Holding } from "./load";

// Ce que les personnages ont en stock : composants d'une recette, détenteurs d'un objet. Fonctions pures.

type Reagent = Pick<ReagentCost, "itemKey" | "quantity" | "owned" | "source">;

export type StockStatus =
  /** Tous les composants en quantité suffisante : crafts = fabrications possibles. */
  | { kind: "complete"; crafts: number; missing: [] }
  /** Il ne manque que des composants vendus par un marchand. */
  | { kind: "vendor"; missing: Reagent[] }
  /** Une partie des composants en stock, le reste à acheter à l'hôtel des ventes ou à récolter. */
  | { kind: "partial"; missing: Reagent[] }
  /** Aucun composant en stock. */
  | { kind: "none"; missing: Reagent[] };

export const STOCK_LABELS: Record<StockStatus["kind"], string> = {
  complete: "Tout en stock",
  vendor: "À compléter chez un marchand",
  partial: "En partie",
  none: "Rien en stock",
};

/** Composants d'une recette face aux stocks des personnages (sacs et banques relevés). */
export function stockStatus(reagents: readonly Reagent[]): StockStatus {
  const missing = reagents.filter((reagent) => reagent.owned < reagent.quantity);
  if (reagents.length > 0 && missing.length === 0) {
    return { kind: "complete", crafts: Math.min(...reagents.map((reagent) => Math.floor(reagent.owned / reagent.quantity))), missing: [] };
  }
  if (reagents.length > 0 && missing.every((reagent) => reagent.source === "marchand")) return { kind: "vendor", missing };
  if (reagents.some((reagent) => reagent.owned > 0)) return { kind: "partial", missing };
  return { kind: "none", missing };
}

/** Faisable sans passer par l'hôtel des ventes : tout en stock, ou le reste chez un marchand. */
export const craftableNow = (status: StockStatus) => status.kind === "complete" || status.kind === "vendor";

/** Où se trouve le stock d'un personnage : « sacs », « banque » ou « sacs 2, banque 4 ». */
export function holdingPlace(holding: Pick<Holding, "bags" | "bank">, format: (value: number) => string = String): string {
  if (holding.bank === 0) return "sacs";
  if (holding.bags === 0) return "banque";
  return `sacs ${format(holding.bags)}, banque ${format(holding.bank)}`;
}
