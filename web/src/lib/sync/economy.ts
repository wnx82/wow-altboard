import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { canonicalHash } from "@/lib/hash";
import { auctionDayToDate } from "@/lib/economy/days";
import type { AccountPayload, MarketPayload, RecipesPayload } from "./schema";

// Import des données économiques d'un compte : prix Auctionator et recettes NaowhForever. Les
// deux blocs sont facultatifs et indépendants des personnages. Rien n'est calculé ici : les
// relevés sont stockés tels quels, le moteur (src/lib/economy) les interprète à la lecture.

export type EconomyCounters = {
  marketsImported: number;
  marketsUnchanged: number;
  marketObservations: number;
  recipeCharacters: number;
  /** Noms d'objets du cache du jeu ajoutés ou modifiés (agent 0.7.0). */
  itemNamesStored: number;
};

export const emptyEconomyCounters = (): EconomyCounters => ({ marketsImported: 0, marketsUnchanged: 0, marketObservations: 0, recipeCharacters: 0, itemNamesStored: 0 });

type Scope = { accountId: number; machineId: number; runId: number; now: Date };

const BATCH = 2_000;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

export async function applyAuctionator(tx: DatabaseOrTransaction, account: AccountPayload, scope: Scope, counters: EconomyCounters): Promise<void> {
  const auctionator = account.auctionator;
  if (!auctionator) return;
  const observedAt = new Date(auctionator.file.modifiedAt);

  for (const batch of chunks(dedupe(auctionator.vendorPrices, (v) => v.key), BATCH)) {
    await tx
      .insert(t.vendorPrices)
      .values(batch.map((v) => ({ itemKey: v.key, priceCopper: v.price, observedAt })))
      .onConflictDoUpdate({
        target: t.vendorPrices.itemKey,
        set: { priceCopper: sql`excluded.price_copper`, observedAt: sql`excluded.observed_at` },
        // Un fichier plus ancien (autre PC) ne remplace pas un prix relevé plus tard.
        setWhere: sql`excluded.observed_at >= ${t.vendorPrices.observedAt} and excluded.price_copper is distinct from ${t.vendorPrices.priceCopper}`,
      });
  }

  for (const market of auctionator.markets) {
    await applyMarket(tx, account.flavor, market, auctionator.file, observedAt, scope, counters);
  }
}

async function applyMarket(
  tx: DatabaseOrTransaction,
  flavor: string,
  market: MarketPayload,
  file: { hash: string },
  observedAt: Date,
  scope: Scope,
  counters: EconomyCounters,
): Promise<void> {
  const [row] = await tx
    .insert(t.markets)
    .values({ flavor, auctionKey: market.key, firstSeenAt: scope.now, lastSeenAt: scope.now })
    .onConflictDoUpdate({ target: [t.markets.flavor, t.markets.auctionKey], set: { lastSeenAt: scope.now } })
    .returning({ id: t.markets.id });
  const marketId = row.id;

  // Même relevé déjà reçu de ce compte (synchronisation répétée, autre PC au fichier identique) : rien à refaire.
  const [known] = await tx
    .select({ id: t.marketImports.id })
    .from(t.marketImports)
    .where(and(eq(t.marketImports.marketId, marketId), eq(t.marketImports.accountId, scope.accountId), eq(t.marketImports.contentHash, market.contentHash)));
  if (known) {
    counters.marketsUnchanged++;
    return;
  }

  const items = dedupe(market.items, (item) => item.key);
  const days = items.flatMap((item) =>
    dedupe(item.days, ([day]) => day).map(([day, low, high, available]) => ({
      marketId,
      itemKey: item.key,
      day: auctionDayToDate(day),
      lowCopper: low,
      highCopper: high,
      available,
      updatedAt: scope.now,
    })),
  );
  const allDays = days.map((d) => d.day).sort();

  const [created] = await tx
    .insert(t.marketImports)
    .values({
      marketId,
      accountId: scope.accountId,
      machineId: scope.machineId,
      syncRunId: scope.runId,
      contentHash: market.contentHash,
      fileHash: file.hash,
      fileModifiedAt: observedAt,
      itemsCount: items.length,
      observationsCount: days.length,
      firstDay: allDays[0] ?? null,
      lastDay: allDays.at(-1) ?? null,
      receivedAt: scope.now,
    })
    .returning({ id: t.marketImports.id });

  for (const batch of chunks(days, BATCH)) {
    await tx
      .insert(t.marketItemDays)
      .values(batch)
      .onConflictDoUpdate({
        target: [t.marketItemDays.marketId, t.marketItemDays.itemKey, t.marketItemDays.day],
        // Fusion de relevés du même jour venus de comptes ou de PC différents.
        set: {
          lowCopper: sql`least(${t.marketItemDays.lowCopper}, excluded.low_copper)`,
          highCopper: sql`greatest(${t.marketItemDays.highCopper}, excluded.high_copper)`,
          available: sql`greatest(${t.marketItemDays.available}, excluded.available)`,
          updatedAt: scope.now,
        },
        setWhere: sql`excluded.low_copper < ${t.marketItemDays.lowCopper} or excluded.high_copper > ${t.marketItemDays.highCopper} or (excluded.available is not null and excluded.available > coalesce(${t.marketItemDays.available}, -1))`,
      });
  }

  const latest = items
    .filter((item) => item.lastMin !== undefined)
    .map((item) => ({
      marketId,
      itemKey: item.key,
      minCopper: item.lastMin!,
      // Auctionator écrit m à chaque relevé et note toujours le jour courant : m est le prix du dernier jour.
      day: auctionDayToDate(Math.max(...item.days.map(([day]) => day))),
      observedAt,
      importId: created.id,
    }));
  for (const batch of chunks(latest, BATCH)) {
    await tx
      .insert(t.marketItemLatest)
      .values(batch)
      .onConflictDoUpdate({
        target: [t.marketItemLatest.marketId, t.marketItemLatest.itemKey],
        set: {
          minCopper: sql`excluded.min_copper`,
          day: sql`excluded.day`,
          observedAt: sql`excluded.observed_at`,
          importId: sql`excluded.import_id`,
        },
        setWhere: sql`excluded.day > ${t.marketItemLatest.day} or (excluded.day = ${t.marketItemLatest.day} and excluded.observed_at > ${t.marketItemLatest.observedAt})`,
      });
  }

  counters.marketsImported++;
  counters.marketObservations += days.length;
}

export async function applyRecipes(tx: DatabaseOrTransaction, account: AccountPayload, now: Date, counters: EconomyCounters): Promise<void> {
  const payload: RecipesPayload | undefined = account.recipes;
  if (!payload || payload.characters.length === 0) return;
  const fileModifiedAt = new Date(payload.file.modifiedAt);

  // Seuls les personnages déjà connus par AltBoard reçoivent leurs recettes.
  const guids = [...new Set(payload.characters.map((c) => c.guid))];
  const rows = await tx.select({ id: t.characters.id, guid: t.characters.guid }).from(t.characters).where(inArray(t.characters.guid, guids));
  const ids = new Map(rows.map((row) => [row.guid, row.id]));
  if (ids.size === 0) return;
  const sources = await tx
    .select()
    .from(t.characterRecipeSources)
    .where(inArray(t.characterRecipeSources.characterId, [...ids.values()]));
  const sourceOf = new Map(sources.map((s) => [s.characterId, s]));

  for (const character of dedupe(payload.characters, (c) => c.guid)) {
    const characterId = ids.get(character.guid);
    if (characterId === undefined) continue;
    const recipes = dedupe(character.recipes, (r) => r.spellId);
    const contentHash = canonicalHash(recipes.map((r) => [r.spellId, r.outputItemId, r.outputQuantity, r.cooldown, r.reagents.map((x) => [x.itemId, x.quantity])]));
    const source = sourceOf.get(characterId);
    // Liste identique, ou fichier plus ancien que celui qui l'a fournie : on ne touche à rien.
    if (source && (source.contentHash === contentHash || source.fileModifiedAt.getTime() > fileModifiedAt.getTime())) continue;

    if (recipes.length > 0) {
      await tx
        .insert(t.recipes)
        .values(
          recipes.map((r) => ({
            spellId: r.spellId,
            skillLine: r.skillLine ?? null,
            outputItemId: r.outputItemId,
            outputQuantity: r.outputQuantity,
            cooldown: r.cooldown,
            firstSeenAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: t.recipes.spellId,
          set: {
            skillLine: sql`coalesce(excluded.skill_line, ${t.recipes.skillLine})`,
            outputItemId: sql`excluded.output_item_id`,
            outputQuantity: sql`excluded.output_quantity`,
            cooldown: sql`excluded.cooldown`,
            updatedAt: now,
          },
          setWhere: sql`(coalesce(excluded.skill_line, ${t.recipes.skillLine}), excluded.output_item_id, excluded.output_quantity, excluded.cooldown) is distinct from (${t.recipes.skillLine}, ${t.recipes.outputItemId}, ${t.recipes.outputQuantity}, ${t.recipes.cooldown})`,
        });
      const spellIds = recipes.map((r) => r.spellId);
      // Composants : données du jeu, remplacés par la dernière description reçue de chaque recette.
      await tx.delete(t.recipeReagents).where(inArray(t.recipeReagents.spellId, spellIds));
      await tx
        .insert(t.recipeReagents)
        .values(recipes.flatMap((r) => dedupe(r.reagents, (x) => x.itemId).map((x) => ({ spellId: r.spellId, itemId: x.itemId, quantity: x.quantity }))));
      await tx
        .delete(t.characterRecipes)
        .where(and(eq(t.characterRecipes.characterId, characterId), notInArray(t.characterRecipes.spellId, spellIds)));
      await tx
        .insert(t.characterRecipes)
        .values(spellIds.map((spellId) => ({ characterId, spellId, firstSeenAt: now })))
        .onConflictDoNothing();
    } else {
      // NaowhForever oublie les recettes d'un métier abandonné : la liste vide l'est aussi ici.
      await tx.delete(t.characterRecipes).where(eq(t.characterRecipes.characterId, characterId));
    }

    await tx
      .insert(t.characterRecipeSources)
      .values({ characterId, fileModifiedAt, contentHash, updatedAt: now })
      .onConflictDoUpdate({ target: t.characterRecipeSources.characterId, set: { fileModifiedAt, contentHash, updatedAt: now } });
    counters.recipeCharacters++;
  }
}

function dedupe<T>(values: readonly T[], key: (value: T) => string | number): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
