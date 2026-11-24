import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { parseScanMarketKey } from "./scans";
import type { AccountPayload, SyncPayload } from "./schema";

// Depuis le build 71037 de WoW Forever (2026-11-21), GetRealmName() et GetNormalizedRealmName()
// rendent une chaîne vide. AltBoard enregistre alors realm = "" et EZAuctioneer range ses scans sous
// une clé de marché sans royaume (« 3::Alliance:faction »). L'agent 0.11.1 transmet ces données
// telles quelles ; le royaume manquant est déduit ici, avant tout traitement :
//   - personnage : le royaume déjà connu pour son GUID, sinon celui des personnages du même serveur
//     (le nombre du GUID, « Player-6947-… »), d'abord dans le document, puis en base ;
//   - marché d'EZAuctioneer : le royaume des personnages du compte joués sans royaume, quand il n'y en
//     a qu'un, écrit comme dans les marchés déjà connus (« CAMWOW EU5 Realm 5 PvE »).
// Ce qui reste impossible à déduire est écarté avec un avertissement, jamais rangé sous un royaume
// inventé.

/** Serveur d'un GUID de joueur (« Player-6947-00000001 » donne « 6947 ») ; null pour un autre format. */
export function guidServer(guid: string): string | null {
  return /^Player-(\d{1,10})-[0-9A-Fa-f]{1,16}$/.exec(guid)?.[1] ?? null;
}

/** Forme normalisée d'un royaume (sans espaces ni tirets), celle de GetNormalizedRealmName et d'AltBoard. */
export function normalizeRealm(realm: string): string {
  return realm.replace(/[\s-]/g, "");
}

/** Clé d'un marché d'EZAuctioneer enregistré sans royaume. */
export function isRealmlessMarket(key: string): boolean {
  return parseScanMarketKey(key)?.realm === "";
}

/** « 3::Alliance:faction » avec le royaume « R » donne « 3:R:Alliance:faction ». */
export function withRealm(key: string, realm: string): string {
  const separator = key.indexOf(":");
  return `${key.slice(0, separator)}:${realm}${key.slice(separator + 1)}`;
}

/** Royaume de chaque serveur cité par des personnages qui en ont un ; le plus récemment vu l'emporte. */
export function realmsByServer(characters: readonly { guid: string; realm: string; lastSeen: number }[]): Map<string, string> {
  const best = new Map<string, { realm: string; lastSeen: number }>();
  for (const character of characters) {
    const server = guidServer(character.guid);
    if (server === null || character.realm === "") continue;
    const known = best.get(server);
    if (!known || character.lastSeen > known.lastSeen) best.set(server, { realm: character.realm, lastSeen: character.lastSeen });
  }
  return new Map([...best].map(([server, entry]) => [server, entry.realm]));
}

type Lookups = {
  /** Royaume déjà enregistré pour un GUID. */
  byGuid: ReadonlyMap<string, string>;
  /** Royaume d'un serveur selon la base. */
  byServer: ReadonlyMap<string, string>;
  /** Royaume tel qu'écrit dans les marchés connus, par client puis par royaume normalisé. */
  marketRealms: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

/**
 * Complète un document dont des royaumes manquent. Pur : les recherches en base sont faites avant,
 * par `resolveMissingRealms`. Un document complet est rendu tel quel.
 */
export function fillRealms(payload: SyncPayload, lookups: Lookups): SyncPayload {
  if (!needsRealms(payload)) return payload;

  const inPayload = realmsByServer(payload.accounts.flatMap((account) => account.characters));
  const realmOf = (guid: string): string | null => {
    const server = guidServer(guid);
    return lookups.byGuid.get(guid) ?? (server === null ? null : (inPayload.get(server) ?? lookups.byServer.get(server) ?? null)) ?? null;
  };

  // Royaumes écrits par EZAuctioneer dans ce document, en plus de ceux de la base.
  const marketRealms = new Map<string, Map<string, string>>();
  for (const [flavor, realms] of lookups.marketRealms) marketRealms.set(flavor, new Map(realms));
  for (const account of payload.accounts) {
    for (const market of account.ezAuctioneer?.markets ?? []) {
      const realm = parseScanMarketKey(market.key)?.realm;
      if (!realm) continue;
      const realms = marketRealms.get(account.flavor) ?? new Map<string, string>();
      if (!realms.has(normalizeRealm(realm))) realms.set(normalizeRealm(realm), realm);
      marketRealms.set(account.flavor, realms);
    }
  }

  return { ...payload, accounts: payload.accounts.map((account) => fillAccount(account, realmOf, marketRealms)) };
}

function needsRealms(payload: SyncPayload): boolean {
  return payload.accounts.some(
    (account) =>
      account.characters.some((character) => character.realm === "") ||
      (account.ezAuctioneer?.markets ?? []).some((market) => isRealmlessMarket(market.key)) ||
      (account.ezAuctioneer?.deals ?? []).some((deals) => isRealmlessMarket(deals.market)) ||
      (account.ezAuctioneer?.portfolios ?? []).some((portfolio) => portfolio.auctions.some((auction) => auction.market !== undefined && isRealmlessMarket(auction.market))),
  );
}

function fillAccount(account: AccountPayload, realmOf: (guid: string) => string | null, marketRealms: ReadonlyMap<string, ReadonlyMap<string, string>>): AccountPayload {
  const warnings = [...account.warnings];
  const characters: AccountPayload["characters"] = [];
  // Royaumes des personnages joués sans royaume : ceux qui ont pu remplir les marchés sans royaume.
  const playedRealms = new Set<string>();
  for (const character of account.characters) {
    if (character.realm !== "") {
      characters.push(character);
      continue;
    }
    const realm = realmOf(character.guid);
    if (realm === null) {
      warnings.push(`personnage ${character.name} ignoré : le jeu ne donne plus son royaume et aucun personnage connu de son serveur ne permet de le déduire`);
      continue;
    }
    playedRealms.add(realm);
    characters.push({ ...character, realm });
  }

  const ez = account.ezAuctioneer;
  if (!ez) return { ...account, characters, warnings };

  // Repli : un compte dont aucun personnage n'a été joué sans royaume, mais qui n'en a que d'un royaume.
  const candidates = playedRealms.size > 0 ? playedRealms : new Set(characters.map((character) => character.realm));
  const realm = candidates.size === 1 ? [...candidates][0] : null;
  const written = realm === null ? null : (marketRealms.get(account.flavor)?.get(normalizeRealm(realm)) ?? realm);
  const fix = (key: string): string | null => (!isRealmlessMarket(key) ? key : written === null ? null : withRealm(key, written));

  const dropped = new Set<string>();
  const markets = ez.markets.flatMap((market) => {
    const key = fix(market.key);
    if (key === null) dropped.add(market.key);
    return key === null ? [] : [{ ...market, key }];
  });
  const deals = ez.deals?.flatMap((list) => {
    const market = fix(list.market);
    if (market === null) dropped.add(list.market);
    return market === null ? [] : [{ ...list, market }];
  });
  const portfolios = ez.portfolios?.map((portfolio) => ({
    ...portfolio,
    auctions: portfolio.auctions.map((auction) => {
      if (auction.market === undefined) return auction;
      const market = fix(auction.market);
      return market === null ? { ...auction, market: undefined } : { ...auction, market };
    }),
  }));
  for (const key of dropped) {
    warnings.push(
      `EZAuctioneer : marché « ${key} » ignoré : le jeu ne donne plus le royaume, et les personnages de ce compte ne le désignent pas (${candidates.size} royaumes)`,
    );
  }

  return {
    ...account,
    characters,
    warnings,
    ezAuctioneer: { ...ez, markets, ...(deals === undefined ? {} : { deals }), ...(portfolios === undefined ? {} : { portfolios }) },
  };
}

/** Recherche en base ce que `fillRealms` ne trouve pas dans le document, puis complète celui-ci. */
export async function resolveMissingRealms(tx: DatabaseOrTransaction, payload: SyncPayload): Promise<SyncPayload> {
  if (!needsRealms(payload)) return payload;

  const missing = payload.accounts.flatMap((account) => account.characters.filter((character) => character.realm === "").map((character) => character.guid));
  const servers = [...new Set(missing.map(guidServer).filter((server): server is string => server !== null))];

  const byGuid = new Map<string, string>();
  if (missing.length > 0) {
    const rows = await tx
      .select({ guid: t.characters.guid, realm: t.realms.name })
      .from(t.characters)
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .where(and(inArray(t.characters.guid, missing), ne(t.realms.name, "")));
    for (const row of rows) byGuid.set(row.guid, row.realm);
  }

  const byServer = new Map<string, string>();
  if (servers.length > 0) {
    const server = sql<string>`split_part(${t.characters.guid}, '-', 2)`;
    const rows = await tx
      .selectDistinctOn([server], { server, realm: t.realms.name })
      .from(t.characters)
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .where(and(sql`${t.characters.guid} like 'Player-%'`, inArray(server, servers), ne(t.realms.name, "")))
      .orderBy(server, desc(t.characters.sourceLastSeenAt));
    for (const row of rows) byServer.set(row.server, row.realm);
  }

  const flavors = [...new Set(payload.accounts.filter((account) => account.ezAuctioneer).map((account) => account.flavor))];
  const marketRealms = new Map<string, Map<string, string>>();
  if (flavors.length > 0) {
    const rows = await tx
      .select({ flavor: t.scanMarkets.flavor, realm: t.scanMarkets.realm })
      .from(t.scanMarkets)
      .where(and(inArray(t.scanMarkets.flavor, flavors), ne(t.scanMarkets.realm, "")))
      .orderBy(desc(t.scanMarkets.lastSeenAt));
    for (const row of rows) {
      const realms = marketRealms.get(row.flavor) ?? new Map<string, string>();
      if (!realms.has(normalizeRealm(row.realm))) realms.set(normalizeRealm(row.realm), row.realm);
      marketRealms.set(row.flavor, realms);
    }
  }

  return fillRealms(payload, { byGuid, byServer, marketRealms });
}
