import { and, eq, max, notInArray } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { chunks, fromUnix } from "./helpers";
import { type AccountPayload, type DealsPayload, PORTFOLIO_KEY_PATTERN, type PortfolioPayload } from "./schema";
import { parseScanMarketKey, scanItemId } from "./scans";

// Revente : portefeuille et affaires d'EZAuctioneer d'un compte (agent 0.11.0, voir docs/RESALE.md).
// EZAuctioneer.lua est propre à chaque PC : les portefeuilles sont rangés par compte et par PC, et le
// fichier d'un PC fait foi pour les siens. Bilan, positions et annonces sont remplacés à chaque envoi ;
// le journal, que l'addon limite à 200 entrées, s'accumule sans doublon.

type Scope = { accountId: number; machineId: number; now: Date };

const BATCH = 1_000;

/** Région, royaume (vide quand l'addon ne le connaissait pas) et personnage d'une clé de portefeuille. */
export function parsePortfolioKey(key: string): { region: string; realm: string; character: string } | null {
  const match = PORTFOLIO_KEY_PATTERN.exec(key);
  return match ? { region: match[1], realm: match[2], character: match[3] } : null;
}

type Candidate = { id: number; name: string };

/**
 * Personnage du compte qui porte ce portefeuille, ou null. Sur WoW Forever, AltBoard enregistre le
 * prénom et le nom (« Ada Brisefer ») mais EZAuctioneer seulement le prénom (« Ada »), et deux
 * personnages peuvent partager un prénom. Le nom exact l'emporte ; sinon le prénom, s'il ne désigne
 * qu'un personnage. Le royaume d'EZAuctioneer n'est pas celui d'AltBoard : il ne sert pas.
 */
export function matchCharacter(name: string, candidates: readonly Candidate[]): number | null {
  const exact = candidates.filter((candidate) => candidate.name === name);
  const matches = exact.length > 0 ? exact : candidates.filter((candidate) => candidate.name.startsWith(`${name} `));
  return matches.length === 1 ? matches[0].id : null;
}

type LogEntry = PortfolioPayload["log"][number];

/**
 * Empreinte de chaque entrée du journal : son contenu, puis son rang parmi les entrées identiques
 * du même envoi (deux achats identiques à la même seconde restent deux achats). Une entrée déjà
 * reçue garde la même empreinte d'un envoi à l'autre.
 */
export function entryHashes(log: readonly LogEntry[]): string[] {
  const seen = new Map<string, number>();
  return log.map((entry) => {
    const content = sha256Hex(
      JSON.stringify([
        entry.at,
        entry.kind,
        entry.key,
        entry.qty,
        entry.amount ?? null,
        entry.fee ?? null,
        entry.gain ?? null,
        entry.unit ?? null,
        entry.deposit ?? null,
        entry.source ?? null,
      ]),
    );
    const rank = seen.get(content) ?? 0;
    seen.set(content, rank + 1);
    return `${content}:${rank}`;
  });
}

export async function applyResale(tx: DatabaseOrTransaction, account: AccountPayload, scope: Scope): Promise<{ portfolios: number; events: number; deals: number }> {
  const payload = account.ezAuctioneer;
  const result = { portfolios: 0, events: 0, deals: 0 };
  if (!payload) return result;
  // Agent antérieur à 0.11.0 : rien n'est envoyé, rien n'est touché.
  if (payload.portfolios) {
    const candidates = await tx
      .select({ id: t.characters.id, name: t.characters.name })
      .from(t.characters)
      .where(eq(t.characters.accountId, scope.accountId));
    const kept: number[] = [];
    for (const portfolio of payload.portfolios) {
      const applied = await applyPortfolio(tx, portfolio, candidates, scope);
      kept.push(applied.id);
      result.portfolios++;
      result.events += applied.events;
    }
    await clearMissing(tx, scope, kept);
  }
  for (const list of payload.deals ?? []) result.deals += await applyDeals(tx, account.flavor, list, scope.now);
  return result;
}

async function applyPortfolio(
  tx: DatabaseOrTransaction,
  portfolio: PortfolioPayload,
  candidates: readonly Candidate[],
  scope: Scope,
): Promise<{ id: number; events: number }> {
  // Le schéma de l'API a déjà vérifié la forme de la clé.
  const { realm, character } = parsePortfolioKey(portfolio.key)!;
  const stats = {
    realizedCopper: portfolio.stats.realized,
    sales: portfolio.stats.sales,
    cutsCopper: portfolio.stats.cuts,
    expired: portfolio.stats.expired,
    depositsLostCopper: portfolio.stats.depositsLost,
    unknownOutcomes: portfolio.stats.unknown,
  };
  const characterId = matchCharacter(character, candidates);
  const [row] = await tx
    .insert(t.resalePortfolios)
    .values({ accountId: scope.accountId, machineId: scope.machineId, portfolioKey: portfolio.key, realm, characterName: character, characterId, ...stats, updatedAt: scope.now })
    .onConflictDoUpdate({
      target: [t.resalePortfolios.accountId, t.resalePortfolios.machineId, t.resalePortfolios.portfolioKey],
      set: { characterId, ...stats, updatedAt: scope.now },
    })
    .returning({ id: t.resalePortfolios.id });
  const portfolioId = row.id;

  await tx.delete(t.resalePositions).where(eq(t.resalePositions.portfolioId, portfolioId));
  if (portfolio.positions.length > 0) {
    await tx.insert(t.resalePositions).values(
      portfolio.positions.map((position) => ({
        portfolioId,
        itemKey: position.key,
        itemId: scanItemId(position.key)!,
        quantity: position.qty,
        costCopper: position.cost,
        listed: position.listed,
        openedAt: position.openedAt === undefined ? null : fromUnix(position.openedAt),
      })),
    );
  }

  await tx.delete(t.resaleAuctions).where(eq(t.resaleAuctions.portfolioId, portfolioId));
  if (portfolio.auctions.length > 0) {
    await tx.insert(t.resaleAuctions).values(
      portfolio.auctions.map((auction) => ({
        portfolioId,
        auctionId: auction.id,
        itemKey: auction.key,
        itemId: scanItemId(auction.key)!,
        quantity: auction.qty,
        unitCopper: auction.unit,
        depositCopper: auction.deposit ?? null,
        cut: auction.cut ?? null,
        marketKey: auction.market ?? null,
        postedAt: auction.postedAt === undefined ? null : fromUnix(auction.postedAt),
      })),
    );
  }

  const hashes = entryHashes(portfolio.log);
  let events = 0;
  for (const batch of chunks(
    portfolio.log.map((entry, index) => ({ entry, hash: hashes[index] })),
    BATCH,
  )) {
    const inserted = await tx
      .insert(t.resaleEvents)
      .values(
        batch.map(({ entry, hash }) => ({
          portfolioId,
          entryHash: hash,
          occurredAt: fromUnix(entry.at),
          kind: entry.kind,
          itemKey: entry.key,
          itemId: scanItemId(entry.key)!,
          quantity: entry.qty,
          amountCopper: entry.amount ?? null,
          feeCopper: entry.fee ?? null,
          gainCopper: entry.gain ?? null,
          unitCopper: entry.unit ?? null,
          depositCopper: entry.deposit ?? null,
          source: entry.source ?? null,
          receivedAt: scope.now,
        })),
      )
      .onConflictDoNothing()
      .returning({ hash: t.resaleEvents.entryHash });
    events += inserted.length;
  }
  return { id: portfolioId, events };
}

/**
 * Portefeuilles du compte sur ce PC absents de l'envoi : l'addon les a vidés (l'agent omet un
 * portefeuille vide). Leur bilan revient à zéro, positions et annonces disparaissent ; leur journal reste.
 */
async function clearMissing(tx: DatabaseOrTransaction, scope: Scope, kept: number[]): Promise<void> {
  const missing = await tx
    .update(t.resalePortfolios)
    .set({ realizedCopper: 0, sales: 0, cutsCopper: 0, expired: 0, depositsLostCopper: 0, unknownOutcomes: 0, updatedAt: scope.now })
    .where(and(eq(t.resalePortfolios.accountId, scope.accountId), eq(t.resalePortfolios.machineId, scope.machineId), kept.length > 0 ? notInArray(t.resalePortfolios.id, kept) : undefined))
    .returning({ id: t.resalePortfolios.id });
  for (const { id } of missing) {
    await tx.delete(t.resalePositions).where(eq(t.resalePositions.portfolioId, id));
    await tx.delete(t.resaleAuctions).where(eq(t.resaleAuctions.portfolioId, id));
  }
}

/** Affaires du dernier scan d'un marché : remplacent la liste en place, sauf si celle-ci est plus récente. */
async function applyDeals(tx: DatabaseOrTransaction, flavor: string, list: DealsPayload, now: Date): Promise<number> {
  const parts = parseScanMarketKey(list.market)!;
  const [market] = await tx
    .insert(t.scanMarkets)
    .values({ flavor, marketKey: list.market, ...parts, firstSeenAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: [t.scanMarkets.flavor, t.scanMarkets.marketKey], set: { lastSeenAt: now } })
    .returning({ id: t.scanMarkets.id });
  const capturedAt = list.at === undefined ? null : fromUnix(list.at);
  const [stored] = await tx.select({ at: max(t.resaleDeals.capturedAt) }).from(t.resaleDeals).where(eq(t.resaleDeals.scanMarketId, market.id));
  if (stored?.at && capturedAt && new Date(stored.at).getTime() > capturedAt.getTime()) return 0;

  await tx.delete(t.resaleDeals).where(eq(t.resaleDeals.scanMarketId, market.id));
  if (list.entries.length === 0) return 0;
  await tx.insert(t.resaleDeals).values(
    list.entries.map((deal, index) => ({
      scanMarketId: market.id,
      rank: index + 1,
      capturedAt,
      receivedAt: now,
      itemKey: deal.key,
      itemId: scanItemId(deal.key)!,
      kind: deal.kind,
      source: deal.source ?? null,
      quantity: deal.qty,
      costCopper: deal.cost,
      resaleCopper: deal.resale,
      profitCopper: deal.profit,
      roi: deal.roi,
      listings: deal.listings ?? null,
      thin: deal.thin ?? null,
      live: deal.live ?? null,
    })),
  );
  return list.entries.length;
}

/** Erreurs Lua de l'addon AltBoard sur ce PC : la liste reçue remplace la précédente (vide : plus d'erreur). */
export async function applyAddonErrors(tx: DatabaseOrTransaction, account: AccountPayload, scope: Scope): Promise<void> {
  if (account.addonErrors === undefined) return;
  const { accountId, machineId, now } = scope;
  await tx.delete(t.accountAddonErrors).where(and(eq(t.accountAddonErrors.accountId, accountId), eq(t.accountAddonErrors.machineId, machineId)));
  if (account.addonErrors.length === 0) return;
  await tx.insert(t.accountAddonErrors).values(
    account.addonErrors.map((error) => ({
      accountId,
      machineId,
      occurredAt: fromUnix(error.at),
      location: error.where,
      message: error.message,
      addonVersion: error.version ?? null,
      receivedAt: now,
    })),
  );
}
