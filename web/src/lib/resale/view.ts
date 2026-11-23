// Calculs de la page Revente (voir docs/RESALE.md), sans base : bilan par objet tiré du journal,
// valeur du stock au prix du marché, libellés des opérations. Montants en pièces de cuivre.

export const EVENT_LABELS: Record<string, string> = {
  buy: "Achat",
  post: "Mise en vente",
  sale: "Vente",
  pending: "Vente à confirmer",
  expire: "Invendu",
  cancel: "Annulation",
  unknown: "Issue inconnue",
  remove: "Retrait",
};

export const DEAL_KINDS: Record<string, string> = { resale: "Revente", vendor: "Marchand" };
export const DEAL_LIVE: Record<string, string> = { live: "en vente", gone: "partie", checking: "vérification" };

/** Clé d'Auctionator d'un objet d'EZAuctioneer (« i:1234:s5 » → « 1234 ») : les variantes partagent le prix de leur objet. */
export const marketKeyOf = (itemId: number) => String(itemId);

export type ResaleEvent = {
  kind: string;
  itemId: number;
  quantity: number;
  amountCopper: number | null;
  feeCopper: number | null;
  gainCopper: number | null;
  depositCopper: number | null;
  occurredAt: Date;
};

export type ItemResult = {
  itemId: number;
  boughtUnits: number;
  spentCopper: number;
  soldUnits: number;
  grossCopper: number;
  feesCopper: number;
  /** Gain des ventes (produit − commission − coût d'achat des unités vendues), selon l'addon. */
  gainCopper: number;
  depositsLostCopper: number;
  /** Coût d'achat des unités vendues : produit − commission − gain. */
  basisCopper: number;
  /** Gain net des dépôts perdus, rapporté au coût d'achat des unités vendues ; null sans vente. */
  roi: number | null;
  lastAt: Date;
};

/** Bilan par objet tiré du journal reçu : achats, ventes, commission, gain, dépôts perdus. Meilleur gain d'abord. */
export function itemResults(events: readonly ResaleEvent[]): ItemResult[] {
  const byItem = new Map<number, ItemResult>();
  for (const event of events) {
    const row = byItem.get(event.itemId) ?? {
      itemId: event.itemId,
      boughtUnits: 0,
      spentCopper: 0,
      soldUnits: 0,
      grossCopper: 0,
      feesCopper: 0,
      gainCopper: 0,
      depositsLostCopper: 0,
      basisCopper: 0,
      roi: null,
      lastAt: event.occurredAt,
    };
    if (event.occurredAt > row.lastAt) row.lastAt = event.occurredAt;
    if (event.kind === "buy") {
      row.boughtUnits += event.quantity;
      row.spentCopper += event.amountCopper ?? 0;
    } else if (event.kind === "sale") {
      const gross = event.amountCopper ?? 0;
      const fee = event.feeCopper ?? 0;
      const gain = event.gainCopper ?? 0;
      row.soldUnits += event.quantity;
      row.grossCopper += gross;
      row.feesCopper += fee;
      row.gainCopper += gain;
      row.basisCopper += gross - fee - gain;
    } else if (event.kind === "expire" || event.kind === "cancel") {
      row.depositsLostCopper += event.depositCopper ?? 0;
    }
    byItem.set(event.itemId, row);
  }
  for (const row of byItem.values()) {
    row.roi = row.soldUnits > 0 && row.basisCopper > 0 ? (row.gainCopper - row.depositsLostCopper) / row.basisCopper : null;
  }
  return [...byItem.values()].sort((a, b) => b.gainCopper - b.depositsLostCopper - (a.gainCopper - a.depositsLostCopper) || b.lastAt.getTime() - a.lastAt.getTime());
}

export type PositionValue = { quantity: number; costCopper: number; unitValue: number | null };

/**
 * Valeur du stock : au prix du marché et, commission déduite, ce qu'il rapporterait vendu à ce prix.
 * Plus-value latente : sur les seules positions dont le prix est connu.
 */
export function stockValue(positions: readonly PositionValue[], auctionCut: number): { invested: number; value: number; priced: number; unrealized: number } {
  let invested = 0;
  let value = 0;
  let priced = 0;
  let unrealized = 0;
  for (const position of positions) {
    invested += position.costCopper;
    if (position.unitValue === null) continue;
    const worth = position.unitValue * position.quantity;
    value += worth;
    priced++;
    unrealized += worth * (1 - auctionCut) - position.costCopper;
  }
  return { invested, value: Math.round(value), priced, unrealized: Math.round(unrealized) };
}

/** Écart d'un prix demandé au prix du marché (0,2 = 20 % au-dessus) ; null sans prix de marché. */
export function premium(unitCopper: number, marketCopper: number | null): number | null {
  return marketCopper === null || marketCopper <= 0 ? null : unitCopper / marketCopper - 1;
}
