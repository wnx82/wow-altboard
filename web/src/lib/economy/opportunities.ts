import type { CraftEvaluation } from "./craft";
import type { FarmSignal } from "./farm";
import type { ItemStats } from "./prices";

// Moteur d'opportunités : classement transversal des décisions (voir docs/ECONOMY-ENGINE.md).
// Chaque opportunité porte son signal chiffré, son horizon, sa confiance, ses raisons et les
// valeurs qui l'ont produite : rien n'y est affirmé qui ne vienne des relevés.

/** 2 : prix complétés par les scans d'EZAuctioneer reliés (site 0.35.0). Un calcul d'une autre version est refait. */
export const ENGINE_VERSION = "2";

export type OpportunityKind = "CRAFT" | "PROCESS" | "DONT_CRAFT" | "SELL" | "KEEP" | "BUY" | "FARM";

export const KIND_LABELS: Record<OpportunityKind, string> = {
  CRAFT: "Crafter",
  PROCESS: "Transformer",
  DONT_CRAFT: "Ne pas crafter",
  SELL: "Vendre",
  KEEP: "Garder",
  BUY: "Acheter",
  FARM: "Farmer",
};

export type Opportunity = {
  kind: OpportunityKind;
  itemKey: string | null;
  spellId: number | null;
  /** Gain (ou perte, négatif) attendu, en pièces de cuivre. */
  valueCopper: number;
  confidence: number;
  horizon: "immédiat" | "quelques jours";
  reasonCodes: string[];
  inputs: Record<string, unknown>;
};

export type OpportunityParameters = {
  auctionCut: number;
  minConfidence: number;
  sellPremium: number;
  keepDiscount: number;
  buyDiscount: number;
  minFarmScore: number;
};

export const DEFAULT_PARAMETERS: OpportunityParameters = {
  auctionCut: 0.05,
  minConfidence: 50,
  sellPremium: 0.1,
  keepDiscount: 0.15,
  buyDiscount: 0.2,
  minFarmScore: 60,
};

export const REASON_LABELS: Record<string, string> = {
  PROFITABLE: "rentable au prix du marché",
  CRAFTABLE_FROM_STOCK: "faisable avec le stock",
  NEGATIVE_MARGIN: "le produit vaut moins que ses composants",
  REAGENTS_WORTH_MORE: "les composants vendus rapportent plus",
  OWNED_REAGENTS: "composants déjà en stock",
  THIN_MARGIN: "marge trop faible",
  PROFIT_NOT_ROBUST: "perte au prix prudent",
  LOW_CONFIDENCE: "confiance insuffisante",
  OUTPUT_PRICE_UNKNOWN: "prix du produit inconnu",
  REAGENT_PRICE_UNKNOWN: "prix d'un composant inconnu",
  OUTPUT_HISTORY_SHORT: "produit relevé moins de 3 jours",
  REAGENT_HISTORY_SHORT: "composant relevé moins de 3 jours",
  THIN_OUTPUT_MARKET: "produit peu offert (1 ou 2 en vente)",
  OUTPUT_PRICE_OUTLIER: "prix du produit anormal",
  VENDOR_REAGENT: "composant acheté chez un marchand",
  COOLDOWN: "recette à temps de recharge",
  PRICE_ABOVE_MEDIAN: "prix au-dessus de sa médiane",
  PRICE_BELOW_MEDIAN: "prix sous sa médiane",
  LOW_SUPPLY: "offre inférieure à l'habitude",
  STABLE_MARKET: "marché stable",
  THIN_MARKET: "marché très étroit",
  PRICE_OUTLIER: "prix anormal (écart robuste)",
  OWNED_STOCK: "en stock sur vos personnages",
  REAGENT_OF_PROFITABLE_CRAFT: "composant d'un craft rentable",
  LIQUID_MARKET: "marché liquide",
};

function statsInputs(stats: ItemStats) {
  return {
    lastDay: stats.lastDay,
    current: stats.current?.minCopper ?? null,
    median30: stats.median30,
    marketValue: stats.marketValue,
    marketValueBasis: stats.marketValueBasis,
    daysObserved30: stats.daysObserved30,
    lastAvailable: stats.lastAvailable,
    medianAvailable30: stats.medianAvailable30,
    volatility30: stats.volatility30,
    confidenceFactors: stats.confidenceFactors,
  };
}

const liquid = (stats: ItemStats) => stats.liquidity === "élevée" || stats.liquidity === "moyenne";

export function buildOpportunities(
  stats: ReadonlyMap<string, ItemStats>,
  crafts: readonly CraftEvaluation[],
  stock: ReadonlyMap<string, number>,
  farmSignals: readonly FarmSignal[],
  parameters: OpportunityParameters = DEFAULT_PARAMETERS,
): Opportunity[] {
  const keep = 1 - parameters.auctionCut;
  const result: Opportunity[] = [];

  const craftInputs = (c: CraftEvaluation) => ({
    output: c.outputKey,
    // Dernier jour relevé du produit : la fraîcheur du prix qui porte la décision.
    lastDay: stats.get(c.outputKey)?.lastDay ?? null,
    outputQuantity: c.outputQuantity,
    outputUnitValue: c.outputUnitValue,
    outputNet: c.outputNet,
    costMarket: c.costMarket,
    costPrudent: c.costPrudent,
    profit: c.profit,
    roi: c.roi,
    reagentsSellNet: c.reagentsSellNet,
    craftableWithVendor: c.craftableWithVendor,
    reagents: c.reagents.map((r) => ({ item: r.itemKey, quantity: r.quantity, source: r.source, unit: r.unitMarket, owned: r.owned })),
    auctionCut: parameters.auctionCut,
  });

  for (const craft of crafts) {
    if (craft.decision === "CRAFT" && craft.profit !== null) {
      result.push({
        kind: craft.isTransformation ? "PROCESS" : "CRAFT",
        itemKey: craft.outputKey,
        spellId: craft.spellId,
        valueCopper: Math.round(craft.profit * Math.max(1, craft.craftableWithVendor)),
        confidence: craft.confidence,
        horizon: "immédiat",
        reasonCodes: craft.reasons,
        inputs: craftInputs(craft),
      });
    } else if ((craft.decision === "DONT_CRAFT" || craft.decision === "SELL_REAGENTS") && craft.profit !== null && craft.confidence >= parameters.minConfidence) {
      result.push({
        kind: "DONT_CRAFT",
        itemKey: craft.outputKey,
        spellId: craft.spellId,
        valueCopper: Math.round(craft.profit),
        confidence: craft.confidence,
        horizon: "immédiat",
        reasonCodes: craft.reasons,
        inputs: craftInputs(craft),
      });
    }
  }

  const profitableReagents = new Set(crafts.filter((c) => c.decision === "CRAFT").flatMap((c) => c.reagents.filter((r) => r.source === "hôtel des ventes").map((r) => r.itemKey)));

  for (const [itemKey, owned] of stock) {
    const s = stats.get(itemKey);
    // Sans valeur de marché (moins de trois jours relevés), l'écart à la médiane ne veut rien dire.
    if (!s || owned <= 0 || s.current === null || s.median30 === null || s.marketValue === null || s.confidence < parameters.minConfidence) continue;
    const ratio = s.current.minCopper / s.median30;
    if (ratio >= 1 + parameters.sellPremium && liquid(s) && !s.outlier) {
      result.push({
        kind: "SELL",
        itemKey,
        spellId: null,
        valueCopper: Math.round(owned * s.current.minCopper * keep),
        confidence: s.confidence,
        horizon: "immédiat",
        reasonCodes: ["PRICE_ABOVE_MEDIAN", "OWNED_STOCK", "LIQUID_MARKET"],
        inputs: { ...statsInputs(s), owned, ratio, auctionCut: parameters.auctionCut },
      });
    } else if (ratio <= 1 - parameters.keepDiscount) {
      result.push({
        kind: "KEEP",
        itemKey,
        spellId: null,
        valueCopper: Math.round(owned * (s.median30 - s.current.minCopper) * keep),
        confidence: s.confidence,
        horizon: "quelques jours",
        reasonCodes: ["PRICE_BELOW_MEDIAN", "OWNED_STOCK"],
        inputs: { ...statsInputs(s), owned, ratio },
      });
    }
  }

  for (const itemKey of profitableReagents) {
    const s = stats.get(itemKey);
    if (!s || s.current === null || s.median30 === null || s.marketValue === null || s.confidence < parameters.minConfidence || !liquid(s)) continue;
    const ratio = s.current.minCopper / s.median30;
    if (ratio <= 1 - parameters.buyDiscount) {
      result.push({
        kind: "BUY",
        itemKey,
        spellId: null,
        valueCopper: Math.round(s.median30 - s.current.minCopper),
        confidence: s.confidence,
        horizon: "immédiat",
        reasonCodes: ["PRICE_BELOW_MEDIAN", "REAGENT_OF_PROFITABLE_CRAFT", "LIQUID_MARKET"],
        inputs: { ...statsInputs(s), ratio, perUnit: true },
      });
    }
  }

  for (const signal of farmSignals) {
    const s = stats.get(signal.itemKey);
    if (!s || signal.score < parameters.minFarmScore || signal.confidence < parameters.minConfidence) continue;
    result.push({
      kind: "FARM",
      itemKey: signal.itemKey,
      spellId: null,
      // Valeur d'une unité récoltée : le rendement réel se mesure avec les sessions de farm.
      valueCopper: Math.round(signal.unitValue * keep),
      confidence: signal.confidence,
      horizon: "quelques jours",
      reasonCodes: signal.reasons,
      inputs: { ...statsInputs(s), score: signal.score, premium: signal.premium, supplyRatio: signal.supplyRatio, perUnit: true },
    });
  }

  // Gains d'abord, pondérés par la confiance ; les crafts à éviter ensuite, du plus coûteux au moindre.
  const weight = (o: Opportunity) => (o.kind === "DONT_CRAFT" ? -Infinity : o.valueCopper * (o.confidence / 100));
  return result.sort((a, b) => {
    if (a.kind === "DONT_CRAFT" && b.kind === "DONT_CRAFT") return a.valueCopper - b.valueCopper;
    return weight(b) - weight(a) || (a.itemKey ?? "").localeCompare(b.itemKey ?? "");
  });
}
