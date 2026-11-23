import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { accountLabel, machineLabel } from "@/lib/dashboard/queries";
import { loadItemNames } from "@/lib/economy/item-names";
import { loadMarketValues, type ItemName } from "@/lib/economy/load";
import { scanMarketLabel } from "@/lib/economy/scans";
import { readSettings } from "@/lib/settings/store";
import { itemResults, marketKeyOf, stockValue, type ItemResult } from "./view";

// Données de la page Revente : portefeuilles d'EZAuctioneer reçus de tous les comptes, positions et
// annonces en cours au prix du marché du site, bilan par objet, journal et affaires repérées en jeu.

/** Entrées du journal montrées sur la page, les plus récentes. */
export const JOURNAL_SHOWN = 60;

export type ResaleCharacter = { characterId: number | null; name: string; className: string | null };

export type PortfolioSummary = ResaleCharacter & {
  id: number;
  account: string;
  /** PC dont le fichier EZAuctioneer.lua porte ce portefeuille. */
  machine: string;
  realm: string;
  realizedCopper: number;
  sales: number;
  cutsCopper: number;
  expired: number;
  depositsLostCopper: number;
  unknownOutcomes: number;
  positions: number;
  updatedAt: Date;
};

export type PositionRow = ResaleCharacter & {
  itemKey: string;
  quantity: number;
  listed: number;
  costCopper: number;
  unitValue: number | null;
  openedAt: Date | null;
};

export type AuctionRow = ResaleCharacter & {
  itemKey: string;
  quantity: number;
  unitCopper: number;
  depositCopper: number | null;
  unitValue: number | null;
  postedAt: Date | null;
};

export type JournalRow = ResaleCharacter & {
  kind: string;
  itemKey: string;
  quantity: number;
  amountCopper: number | null;
  gainCopper: number | null;
  unitCopper: number | null;
  depositCopper: number | null;
  occurredAt: Date;
};

export type DealList = {
  scanMarketId: number;
  label: string;
  capturedAt: Date | null;
  entries: {
    rank: number;
    itemKey: string;
    kind: string;
    quantity: number;
    costCopper: number;
    resaleCopper: number;
    profitCopper: number;
    roi: number;
    listings: number | null;
    thin: boolean | null;
    live: string | null;
  }[];
};

export type ResaleData = {
  portfolios: PortfolioSummary[];
  positions: PositionRow[];
  auctions: AuctionRow[];
  items: (ItemResult & { itemKey: string })[];
  journal: JournalRow[];
  journalTotal: number;
  deals: DealList[];
  names: Map<string, ItemName>;
  market: { id: number; label: string } | null;
  auctionCut: number;
  totals: {
    realizedCopper: number;
    sales: number;
    cutsCopper: number;
    expired: number;
    depositsLostCopper: number;
    unknownOutcomes: number;
    invested: number;
    value: number;
    priced: number;
    unrealized: number;
  };
};

export async function loadResale(db: Database, now: Date): Promise<ResaleData> {
  const owner = {
    characterId: t.resalePortfolios.characterId,
    name: sql<string>`coalesce(${t.characters.name}, ${t.resalePortfolios.characterName})`,
    className: t.characters.class,
  };
  const [portfolioRows, positionRows, auctionRows, eventRows, journalRows, journalCount, dealRows, settings] = await Promise.all([
    db
      .select({
        id: t.resalePortfolios.id,
        ...owner,
        accountDisplayName: t.wowAccounts.displayName,
        accountFolderHint: t.wowAccounts.folderHint,
        machineDisplayName: t.machines.displayName,
        machineHostname: t.machines.hostname,
        realm: t.resalePortfolios.realm,
        realizedCopper: t.resalePortfolios.realizedCopper,
        sales: t.resalePortfolios.sales,
        cutsCopper: t.resalePortfolios.cutsCopper,
        expired: t.resalePortfolios.expired,
        depositsLostCopper: t.resalePortfolios.depositsLostCopper,
        unknownOutcomes: t.resalePortfolios.unknownOutcomes,
        updatedAt: t.resalePortfolios.updatedAt,
        positions: sql<number>`(select count(*)::int from ${t.resalePositions} p where p.portfolio_id = ${t.resalePortfolios.id} and p.quantity > 0)`,
      })
      .from(t.resalePortfolios)
      .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.resalePortfolios.accountId))
      .innerJoin(t.machines, eq(t.machines.id, t.resalePortfolios.machineId))
      .leftJoin(t.characters, eq(t.characters.id, t.resalePortfolios.characterId))
      .orderBy(desc(t.resalePortfolios.realizedCopper), asc(t.resalePortfolios.characterName)),
    db
      .select({ ...owner, itemId: t.resalePositions.itemId, quantity: t.resalePositions.quantity, listed: t.resalePositions.listed, costCopper: t.resalePositions.costCopper, openedAt: t.resalePositions.openedAt })
      .from(t.resalePositions)
      .innerJoin(t.resalePortfolios, eq(t.resalePortfolios.id, t.resalePositions.portfolioId))
      .leftJoin(t.characters, eq(t.characters.id, t.resalePortfolios.characterId))
      .where(sql`${t.resalePositions.quantity} > 0`)
      .orderBy(desc(t.resalePositions.costCopper)),
    db
      .select({ ...owner, itemId: t.resaleAuctions.itemId, quantity: t.resaleAuctions.quantity, unitCopper: t.resaleAuctions.unitCopper, depositCopper: t.resaleAuctions.depositCopper, postedAt: t.resaleAuctions.postedAt })
      .from(t.resaleAuctions)
      .innerJoin(t.resalePortfolios, eq(t.resalePortfolios.id, t.resaleAuctions.portfolioId))
      .leftJoin(t.characters, eq(t.characters.id, t.resalePortfolios.characterId))
      .orderBy(desc(t.resaleAuctions.postedAt)),
    db
      .select({
        kind: t.resaleEvents.kind,
        itemId: t.resaleEvents.itemId,
        quantity: t.resaleEvents.quantity,
        amountCopper: t.resaleEvents.amountCopper,
        feeCopper: t.resaleEvents.feeCopper,
        gainCopper: t.resaleEvents.gainCopper,
        depositCopper: t.resaleEvents.depositCopper,
        occurredAt: t.resaleEvents.occurredAt,
      })
      .from(t.resaleEvents)
      .where(inArray(t.resaleEvents.kind, ["buy", "sale", "expire", "cancel"])),
    db
      .select({
        ...owner,
        kind: t.resaleEvents.kind,
        itemId: t.resaleEvents.itemId,
        quantity: t.resaleEvents.quantity,
        amountCopper: t.resaleEvents.amountCopper,
        gainCopper: t.resaleEvents.gainCopper,
        unitCopper: t.resaleEvents.unitCopper,
        depositCopper: t.resaleEvents.depositCopper,
        occurredAt: t.resaleEvents.occurredAt,
      })
      .from(t.resaleEvents)
      .innerJoin(t.resalePortfolios, eq(t.resalePortfolios.id, t.resaleEvents.portfolioId))
      .leftJoin(t.characters, eq(t.characters.id, t.resalePortfolios.characterId))
      .orderBy(desc(t.resaleEvents.occurredAt), desc(t.resaleEvents.entryHash))
      .limit(JOURNAL_SHOWN),
    db.select({ total: count() }).from(t.resaleEvents),
    db
      .select({
        scanMarketId: t.resaleDeals.scanMarketId,
        house: t.scanMarkets.house,
        faction: t.scanMarkets.faction,
        realm: t.scanMarkets.realm,
        capturedAt: t.resaleDeals.capturedAt,
        rank: t.resaleDeals.rank,
        itemId: t.resaleDeals.itemId,
        kind: t.resaleDeals.kind,
        quantity: t.resaleDeals.quantity,
        costCopper: t.resaleDeals.costCopper,
        resaleCopper: t.resaleDeals.resaleCopper,
        profitCopper: t.resaleDeals.profitCopper,
        roi: t.resaleDeals.roi,
        listings: t.resaleDeals.listings,
        thin: t.resaleDeals.thin,
        live: t.resaleDeals.live,
      })
      .from(t.resaleDeals)
      .innerJoin(t.scanMarkets, eq(t.scanMarkets.id, t.resaleDeals.scanMarketId))
      .orderBy(asc(t.resaleDeals.scanMarketId), asc(t.resaleDeals.rank)),
    readSettings(db),
  ]);

  const keys = [...new Set([...positionRows, ...auctionRows, ...eventRows, ...dealRows].map((row) => marketKeyOf(row.itemId)))];
  const [names, values] = await Promise.all([loadItemNames(db, keys), loadMarketValues(db, keys, now)]);
  const valueOf = (itemId: number) => values.values.get(marketKeyOf(itemId)) ?? null;
  const auctionCut = (settings.auctionCutPercent ?? 5) / 100;

  const portfolios: PortfolioSummary[] = portfolioRows.map(({ accountDisplayName, accountFolderHint, machineDisplayName, machineHostname, ...row }) => ({
    ...row,
    account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }),
    machine: machineLabel({ displayName: machineDisplayName, hostname: machineHostname }),
  }));
  const positions: PositionRow[] = positionRows.map(({ itemId, ...row }) => ({ ...row, itemKey: marketKeyOf(itemId), unitValue: valueOf(itemId) }));
  const auctions: AuctionRow[] = auctionRows.map(({ itemId, ...row }) => ({ ...row, itemKey: marketKeyOf(itemId), unitValue: valueOf(itemId) }));
  const deals = new Map<number, DealList>();
  for (const row of dealRows) {
    const list = deals.get(row.scanMarketId) ?? {
      scanMarketId: row.scanMarketId,
      label: scanMarketLabel({ house: row.house, faction: row.faction, realm: row.realm }),
      capturedAt: row.capturedAt,
      entries: [],
    };
    list.entries.push({
      rank: row.rank,
      itemKey: marketKeyOf(row.itemId),
      kind: row.kind,
      quantity: row.quantity,
      costCopper: row.costCopper,
      resaleCopper: row.resaleCopper,
      profitCopper: row.profitCopper,
      roi: row.roi,
      listings: row.listings,
      thin: row.thin,
      live: row.live,
    });
    deals.set(row.scanMarketId, list);
  }

  const sum = (field: keyof Pick<PortfolioSummary, "realizedCopper" | "sales" | "cutsCopper" | "expired" | "depositsLostCopper" | "unknownOutcomes">) =>
    portfolios.reduce((total, row) => total + row[field], 0);
  return {
    portfolios,
    positions,
    auctions,
    items: itemResults(eventRows).map((row) => ({ ...row, itemKey: marketKeyOf(row.itemId) })),
    journal: journalRows.map(({ itemId, ...row }) => ({ ...row, itemKey: marketKeyOf(itemId) })),
    journalTotal: journalCount[0]?.total ?? 0,
    deals: [...deals.values()].sort((a, b) => (b.capturedAt?.getTime() ?? 0) - (a.capturedAt?.getTime() ?? 0)),
    names,
    market: values.market,
    auctionCut,
    totals: {
      realizedCopper: sum("realizedCopper"),
      sales: sum("sales"),
      cutsCopper: sum("cutsCopper"),
      expired: sum("expired"),
      depositsLostCopper: sum("depositsLostCopper"),
      unknownOutcomes: sum("unknownOutcomes"),
      ...stockValue(positions, auctionCut),
    },
  };
}
