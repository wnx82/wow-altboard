import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Database, DatabaseOrTransaction } from "@/db/client";
import * as t from "@/db/schema";
import { storeClientNames } from "@/lib/economy/item-names";
import { recordAchievements } from "@/lib/goals/store";
import { sqlState } from "@/lib/errors";
import { canonicalHash } from "@/lib/hash";
import { readSettings } from "@/lib/settings/store";
import { applyAuctionator, applyRecipes, emptyEconomyCounters, type EconomyCounters } from "./economy";
import { AGENT_NOTICE, AGENT_WARNING } from "./codes";
import { blockColumns, identityColumns, replaceDetails } from "./character-details";
import { chunks, fromUnix, uniqueBy } from "./helpers";
import { applyBaganator } from "./inventory";
import { repairIdentity, withKnownIdentity } from "./identity";
import { applyLedger } from "./ledger";
import { resolveMissingRealms } from "./realms";
import { applyAddonErrors, applyResale } from "./resale";
import { applyEzAuctioneer } from "./scans";
import type { AccountPayload, CharacterPayload, SyncPayload } from "./schema";

export type SyncResult = {
  runId: number;
  /**
   * « partial » : l'agent a signalé des avertissements, conservés dans sync_errors. Ses informations
   * (agent_notice) y sont aussi, sans rendre la synchronisation partielle.
   */
  status: "success" | "partial";
  accountsReceived: number;
  charactersReceived: number;
  charactersCreated: number;
  charactersUpdated: number;
  charactersUnchanged: number;
  charactersStale: number;
  snapshotsCreated: number;
  errors: { code: string; message: string }[];
} & EconomyCounters;

export type SyncContext = { tokenId: number; requestId: string; now: Date } & SyncLockOptions;

// Un agent antérieur à 0.9.0 envoie parmi ses avertissements les personnages que Baganator connaît
// et qu'AltBoard n'a jamais vus : une information, que l'agent 0.9.0 range lui-même à part.
const LEGACY_NOTICES = [/^Baganator : \d+ personnages? absents? d'AltBoard sur ce compte/];

/** Sépare les avertissements reçus des informations, y compris celles d'un agent plus ancien. */
export function classifyRemarks(warnings: string[], notices: string[]): { warnings: string[]; notices: string[] } {
  const legacy = warnings.filter((message) => LEGACY_NOTICES.some((pattern) => pattern.test(message)));
  return { warnings: warnings.filter((message) => !legacy.includes(message)), notices: [...legacy, ...notices] };
}

/** Le jeton présenté est déjà lié à une autre machine. */
export class TokenMachineMismatchError extends Error {
  constructor() {
    super("token is bound to another machine");
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Les synchronisations sont sérialisées : deux PC envoyant le même personnage au même instant
// ne peuvent pas se marcher dessus. Verrou de transaction ; la réinitialisation des personnages
// et la suppression d'un compte prennent le même.
export const SYNC_LOCK_KEY = 7_230_415_901;
const BATCH = 1_000;

// Délais appliqués par le serveur PostgreSQL à la transaction qui prend le verrou, tous sous le
// délai du client (query_timeout, 15 s, db/client.ts). Sans eux, le client abandonnait seul une
// attente trop longue : la requête continuait côté serveur, le ROLLBACK restait derrière elle et la
// connexion revenait au pool au milieu d'une transaction qui finissait par obtenir le verrou.
// Annulée par le serveur, la requête échoue proprement (55P03 pour le verrou, 57014 au-delà du
// délai) et la transaction est annulée.
export const SYNC_LOCK_TIMEOUT_MS = 8_000;
const STATEMENT_TIMEOUT_MS = 12_000;
// Filet : une transaction restée ouverte sans requête est fermée par le serveur.
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

const LOCK_NOT_AVAILABLE = "55P03";
const QUERY_CANCELED = "57014";

export type SyncLockOptions = { lockTimeoutMs?: number };

/**
 * Pose les délais de la transaction puis prend le verrou des synchronisations. Verrou occupé
 * au-delà du délai : l'erreur PostgreSQL 55P03 (lock_not_available), voir `isSyncBusy`.
 */
export async function takeSyncLock(tx: DatabaseOrTransaction, options: SyncLockOptions = {}): Promise<void> {
  // set_config(…, true) vaut SET LOCAL, avec des paramètres liés : jusqu'à la fin de la transaction.
  await tx.execute(sql`select
    set_config('lock_timeout', ${`${options.lockTimeoutMs ?? SYNC_LOCK_TIMEOUT_MS}ms`}, true),
    set_config('statement_timeout', ${`${STATEMENT_TIMEOUT_MS}ms`}, true),
    set_config('idle_in_transaction_session_timeout', ${`${IDLE_IN_TRANSACTION_TIMEOUT_MS}ms`}, true)`);
  await tx.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`);
}

/** Le verrou des synchronisations n'a pas été obtenu dans le délai : une autre écriture est en cours. */
export const isSyncBusy = (error: unknown) => sqlState(error) === LOCK_NOT_AVAILABLE;
/** Ce que voit l'administrateur quand une synchronisation garde le verrou trop longtemps. */
export const SYNC_BUSY_MESSAGE = "Une synchronisation est en cours : réessayez dans quelques secondes.";
/** Une requête a dépassé le délai du serveur : la transaction a été annulée. */
export const isSyncTimeout = (error: unknown) => sqlState(error) === QUERY_CANCELED;

/** Hash de l'état complet reçu : identique si et seulement si le personnage n'a pas bougé d'un champ. */
export function contentHash(character: CharacterPayload): string {
  return canonicalHash(character);
}

/**
 * Hash des seuls champs de progression. Exclut ce qui change sans que le personnage progresse :
 * zone, expérience reposée, statistiques (dépendantes des améliorations actives), horodatages,
 * contenu et remplissage des sacs.
 */
export function snapshotHash(character: CharacterPayload): string {
  return canonicalHash({
    level: character.level,
    xp: character.xp,
    xpMax: character.xpMax,
    moneyCopper: character.moneyCopper,
    itemLevel: character.itemLevel,
    guild: character.guild,
    professions: character.professions.map((p) => [p.skillLine, p.rank, p.max]),
    gear: character.gear.map((g) => [g.slot, g.itemId, g.enchantId]),
    reputations: character.reputations.map((r) => [r.factionId, r.reaction, r.current]),
    currencies: character.currencies.map((c) => [c.name, c.quantity]),
  });
}

function snapshotData(character: CharacterPayload) {
  return {
    guild: character.guild ?? null,
    zone: character.zone ?? null,
    professions: character.professions.map((p) => ({ skillLine: p.skillLine, name: p.name, rank: p.rank ?? null, max: p.max ?? null })),
    reputations: character.reputations.map((r) => ({
      factionId: r.factionId,
      name: r.name,
      reaction: r.reaction ?? null,
      current: r.current ?? null,
      min: r.min ?? null,
      max: r.max ?? null,
    })),
    currencies: character.currencies.map((c) => ({ name: c.name, quantity: c.quantity })),
    gear: character.gear.map((g) => ({ slot: g.slot, itemId: g.itemId ?? null, name: g.name ?? null, itemLevel: g.itemLevel ?? null })),
    bagSlots: character.bags ? { used: character.bags.slotsUsed ?? null, total: character.bags.slotsTotal ?? null } : null,
    bankSlots: character.bank ? { used: character.bank.slotsUsed ?? null, total: character.bank.slotsTotal ?? null } : null,
  };
}

export async function processSync(db: Database, document: SyncPayload, context: SyncContext): Promise<SyncResult> {
  const { now } = context;
  const started = Date.now();

  return db.transaction(async (tx) => {
    await takeSyncLock(tx, context);
    // Royaumes que le jeu ne donne plus (WoW Forever, build 71037) : déduits avant tout le reste.
    const payload = await resolveMissingRealms(tx, document);

    const [machine] = await tx
      .insert(t.machines)
      .values({
        machineUuid: payload.machine.uuid,
        hostname: payload.machine.hostname,
        displayName: payload.machine.displayName ?? null,
        agentVersion: payload.agentVersion,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: t.machines.machineUuid,
        set: {
          hostname: payload.machine.hostname,
          // Un nom saisi dans l'interface n'est jamais écrasé par l'agent.
          displayName: sql`coalesce(${t.machines.displayName}, excluded.display_name)`,
          agentVersion: payload.agentVersion,
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: t.machines.id });

    // Un jeton appartient à la première machine qui l'utilise, et à elle seule.
    const [token] = await tx.select({ machineId: t.agentTokens.machineId }).from(t.agentTokens).where(eq(t.agentTokens.id, context.tokenId)).for("update");
    if (!token || (token.machineId !== null && token.machineId !== machine.id)) throw new TokenMachineMismatchError();
    await tx.update(t.agentTokens).set({ machineId: machine.id, lastUsedAt: now }).where(eq(t.agentTokens.id, context.tokenId));

    const [run] = await tx
      .insert(t.syncRuns)
      .values({
        machineId: machine.id,
        requestId: context.requestId,
        startedAt: now,
        status: "success",
        agentVersion: payload.agentVersion,
        schemaVersion: payload.schemaVersion,
        sourceHash: canonicalHash(payload.accounts.map((a) => `${a.accountKey}:${a.file.hash}`).sort()),
      })
      .returning({ id: t.syncRuns.id });

    const { charactersCutoffAt: cutoff } = await readSettings(tx);
    const counters = { created: 0, updated: 0, unchanged: 0, stale: 0, snapshots: 0, characters: 0 };
    const economy = emptyEconomyCounters();
    for (const account of payload.accounts) {
      const accountId = await applyAccount(tx, account, { machineId: machine.id, runId: run.id, now, cutoff }, counters);
      // Après les personnages : les recettes se rattachent à des personnages déjà connus.
      await applyAuctionator(tx, account, { accountId, machineId: machine.id, runId: run.id, now }, economy);
      await applyRecipes(tx, account, now, economy);
      await applyBaganator(tx, account, accountId, now);
      await applyEzAuctioneer(tx, account, { accountId, machineId: machine.id, runId: run.id, now }, economy);
      const resale = await applyResale(tx, account, { accountId, machineId: machine.id, now });
      economy.resalePortfolios += resale.portfolios;
      economy.resaleEvents += resale.events;
      economy.resaleDeals += resale.deals;
      await applyAddonErrors(tx, account, { accountId, machineId: machine.id, now });
    }
    if (payload.itemNames) economy.itemNamesStored = await storeClientNames(tx, payload.itemNames, now);

    // Une fois toutes les données appliquées : un objectif que ce document fait atteindre est daté
    // de cette synchronisation.
    const guids = payload.accounts.flatMap((account) => account.characters.map((character) => character.guid));
    if (guids.length > 0) {
      const received = await tx.select({ id: t.characters.id }).from(t.characters).where(inArray(t.characters.guid, guids));
      await recordAchievements(tx, received.map((row) => row.id), now);
    }

    // Seuls les avertissements rendent la synchronisation partielle ; les informations sont gardées
    // à côté, sous leur propre code.
    const remarks = payload.accounts.flatMap((account) => {
      const { warnings: kept, notices } = classifyRemarks(account.warnings, account.notices ?? []);
      return [
        ...kept.map((message) => ({ syncRunId: run.id, accountKey: account.accountKey, code: AGENT_WARNING, message })),
        ...notices.map((message) => ({ syncRunId: run.id, accountKey: account.accountKey, code: AGENT_NOTICE, message })),
      ];
    });
    if (remarks.length > 0) await tx.insert(t.syncErrors).values(remarks);
    const warnings = remarks.filter((remark) => remark.code === AGENT_WARNING);
    const status = warnings.length > 0 ? "partial" : "success";

    await tx
      .update(t.syncRuns)
      .set({
        status,
        errorsCount: warnings.length,
        finishedAt: new Date(now.getTime() + (Date.now() - started)),
        durationMs: Date.now() - started,
        accountsDetected: payload.accounts.length,
        charactersDetected: counters.characters,
        charactersCreated: counters.created,
        charactersUpdated: counters.updated,
        charactersUnchanged: counters.unchanged,
        charactersStale: counters.stale,
        snapshotsCreated: counters.snapshots,
      })
      .where(eq(t.syncRuns.id, run.id));

    return {
      runId: run.id,
      status,
      accountsReceived: payload.accounts.length,
      charactersReceived: counters.characters,
      charactersCreated: counters.created,
      charactersUpdated: counters.updated,
      charactersUnchanged: counters.unchanged,
      charactersStale: counters.stale,
      snapshotsCreated: counters.snapshots,
      errors: [],
      ...economy,
    };
  });
}

type Counters = { created: number; updated: number; unchanged: number; stale: number; snapshots: number; characters: number };
/** cutoff : date limite posée par la dernière réinitialisation des personnages, s'il y en a eu une. */
type Scope = { machineId: number; runId: number; now: Date; cutoff: Date | null };

async function applyAccount(tx: Transaction, account: AccountPayload, scope: Scope, counters: Counters): Promise<number> {
  const { machineId, now } = scope;

  const [row] = await tx
    .insert(t.wowAccounts)
    .values({ accountKey: account.accountKey, folderHint: account.folderHint, folderName: account.folderName ?? null, lastSyncAt: now })
    .onConflictDoUpdate({
      target: t.wowAccounts.accountKey,
      // Un agent antérieur à 0.6.0, sur un autre PC, n'efface pas le nom complet déjà reçu.
      set: { folderHint: account.folderHint, folderName: sql`coalesce(excluded.folder_name, ${t.wowAccounts.folderName})`, lastSyncAt: now, updatedAt: now },
    })
    .returning({ id: t.wowAccounts.id });
  const accountId = row.id;

  const seen = {
    flavor: account.flavor,
    addonSchema: account.addonSchema ?? null,
    addonVersion: account.addonVersion ?? null,
    lastFileHash: account.file.hash,
    lastFileModifiedAt: new Date(account.file.modifiedAt),
    lastSeenAt: now,
  };
  await tx
    .insert(t.machineAccounts)
    .values({ machineId, accountId, firstSeenAt: now, ...seen })
    .onConflictDoUpdate({ target: [t.machineAccounts.machineId, t.machineAccounts.accountId], set: seen });

  for (const batch of chunks(uniqueBy(account.items, (item) => item.key), BATCH)) {
    await tx
      .insert(t.items)
      .values(
        batch.map((item) => ({
          itemKey: item.key,
          itemId: item.itemId,
          suffixId: item.suffixId ?? null,
          name: item.name ?? null,
          quality: item.quality ?? null,
          icon: item.icon ?? null,
          link: item.link ?? null,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: t.items.itemKey,
        set: {
          // Une valeur connue n'est jamais remplacée par une absence (objet pas encore chargé par le client).
          name: sql`coalesce(excluded.name, ${t.items.name})`,
          quality: sql`coalesce(excluded.quality, ${t.items.quality})`,
          icon: sql`coalesce(excluded.icon, ${t.items.icon})`,
          link: sql`coalesce(excluded.link, ${t.items.link})`,
          updatedAt: now,
        },
        // Pas d'écriture si rien ne change : la plupart des objets sont identiques d'une synchro à l'autre.
        setWhere: sql`(coalesce(excluded.name, ${t.items.name}), coalesce(excluded.quality, ${t.items.quality}), coalesce(excluded.icon, ${t.items.icon}), coalesce(excluded.link, ${t.items.link})) is distinct from (${t.items.name}, ${t.items.quality}, ${t.items.icon}, ${t.items.link})`,
      });
  }

  // Identité relevée par AltBoard avant que le client ne la donne : niveau d'Allemano Ledger, expérience inconnue.
  const received = uniqueBy(account.characters, (character) => character.guid).map(repairIdentity);
  counters.characters += received.length;
  if (received.length === 0) return accountId;

  const guids = received.map(({ character }) => character.guid);
  const existingRows = await tx
    .select({
      id: t.characters.id,
      guid: t.characters.guid,
      sourceLastSeenAt: t.characters.sourceLastSeenAt,
      contentHash: t.characters.contentHash,
      statsAt: t.characters.statsAt,
      bagsAt: t.characters.bagsAt,
      bankAt: t.characters.bankAt,
      level: t.characters.level,
      xp: t.characters.xp,
      xpMax: t.characters.xpMax,
      restedXp: t.characters.restedXp,
      guild: t.characters.guild,
    })
    .from(t.characters)
    .where(inArray(t.characters.guid, guids));
  const existing = new Map(existingRows.map((character) => [character.guid, character]));

  // Après une réinitialisation, un personnage inconnu et non vu en jeu depuis la date limite n'est
  // pas recréé : un PC qui garde un ancien fichier (celui de la bêta) le renvoie à chaque envoi.
  const cutoffMs = scope.cutoff?.getTime() ?? null;
  const characters = received
    .filter(({ character }) => cutoffMs === null || existing.has(character.guid) || character.lastSeen * 1000 >= cutoffMs)
    // Relevé non fiable : la guilde et l'expérience reposée déjà connues restent, au lieu d'un départ de guilde fictif.
    .map(({ character, unreliable }) => {
      const known = existing.get(character.guid);
      return unreliable && known ? withKnownIdentity(character, known) : character;
    });
  counters.stale += received.length - characters.length;
  if (characters.length === 0) return accountId;

  const realmNames = [...new Set(characters.map((character) => character.realm))];
  await tx.insert(t.realms).values(realmNames.map((name) => ({ name }))).onConflictDoNothing({ target: t.realms.name });
  const realmRows = await tx.select({ id: t.realms.id, name: t.realms.name }).from(t.realms).where(inArray(t.realms.name, realmNames));
  const realmIds = new Map(realmRows.map((realm) => [realm.name, realm.id]));

  const latestSnapshots =
    existingRows.length === 0
      ? []
      : await tx
          .selectDistinctOn([t.characterSnapshots.characterId], {
            characterId: t.characterSnapshots.characterId,
            snapshotHash: t.characterSnapshots.snapshotHash,
          })
          .from(t.characterSnapshots)
          .where(inArray(t.characterSnapshots.characterId, existingRows.map((character) => character.id)))
          .orderBy(t.characterSnapshots.characterId, desc(t.characterSnapshots.capturedAt));
  const lastSnapshotHash = new Map(latestSnapshots.map((snapshot) => [snapshot.characterId, snapshot.snapshotHash]));

  const touched: number[] = [];
  for (const character of characters) {
    const lastSeen = fromUnix(character.lastSeen);
    const hash = contentHash(character);
    const known = existing.get(character.guid);
    let characterId: number;

    if (!known) {
      const [created] = await tx
        .insert(t.characters)
        .values({
          guid: character.guid,
          ...identityColumns(character, accountId, realmIds.get(character.realm)!),
          ...blockColumns(character, { stats: true, bags: true, bank: true }),
          sourceLastSeenAt: lastSeen,
          contentHash: hash,
          lastMachineId: machineId,
          firstSeenAt: now,
          lastSyncAt: now,
        })
        .returning({ id: t.characters.id });
      characterId = created.id;
      await replaceDetails(tx, characterId, character, { stats: true, bags: true, bank: true });
      await applyLedger(tx, characterId, character, scope);
      counters.created++;
      counters.snapshots += await addSnapshot(tx, characterId, character, scope);
    } else {
      characterId = known.id;
      if (lastSeen.getTime() < known.sourceLastSeenAt.getTime()) {
        // Ce PC détient un fichier plus ancien que l'état déjà connu : on ne régresse pas.
        // Ses temps par niveau restent utiles : ils ont pu être relevés sur ce PC seulement.
        await applyLedger(tx, characterId, character, scope);
        counters.stale++;
      } else if (hash === known.contentHash) {
        counters.unchanged++;
        touched.push(characterId);
      } else {
        // Chaque bloc daté n'est remplacé que par un bloc au moins aussi récent : un PC qui n'a
        // jamais vu la banque n'efface pas celle qu'un autre PC a relevée.
        const blocks = {
          stats: character.stats !== undefined && isFresh(character.statsAt ?? character.lastSeen, known.statsAt),
          bags: character.bags !== undefined && isFresh(character.bags.at, known.bagsAt),
          bank: character.bank !== undefined && isFresh(character.bank.at, known.bankAt),
        };
        await tx
          .update(t.characters)
          .set({
            ...identityColumns(character, accountId, realmIds.get(character.realm)!),
            ...blockColumns(character, blocks),
            sourceLastSeenAt: lastSeen,
            contentHash: hash,
            lastMachineId: machineId,
            lastSyncAt: now,
            updatedAt: now,
          })
          .where(eq(t.characters.id, characterId));
        await replaceDetails(tx, characterId, character, blocks);
        await applyLedger(tx, characterId, character, scope);
        counters.updated++;
        if (lastSnapshotHash.get(characterId) !== snapshotHash(character)) {
          counters.snapshots += await addSnapshot(tx, characterId, character, scope);
        }
      }
    }

    await tx
      .insert(t.characterMachines)
      .values({ characterId, machineId, sourceLastSeenAt: lastSeen, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [t.characterMachines.characterId, t.characterMachines.machineId],
        set: { sourceLastSeenAt: lastSeen, lastSeenAt: now },
      });
  }

  if (touched.length > 0) await tx.update(t.characters).set({ lastSyncAt: now }).where(inArray(t.characters.id, touched));
  return accountId;
}

function isFresh(incomingSeconds: number, storedAt: Date | null): boolean {
  return storedAt === null || incomingSeconds * 1000 >= storedAt.getTime();
}

/** Renvoie 1 si un snapshot a été créé, 0 s'il existait déjà pour cet instant (synchronisation rejouée). */
async function addSnapshot(tx: Transaction, characterId: number, character: CharacterPayload, scope: Scope): Promise<number> {
  const inserted = await tx
    .insert(t.characterSnapshots)
    .values({
      characterId,
      capturedAt: fromUnix(character.lastSeen),
      receivedAt: scope.now,
      syncRunId: scope.runId,
      snapshotHash: snapshotHash(character),
      level: character.level ?? null,
      xp: character.xp ?? null,
      xpMax: character.xpMax ?? null,
      moneyCopper: character.moneyCopper ?? null,
      itemLevel: character.itemLevel ?? null,
      restedXp: character.restedXp ?? null,
      data: snapshotData(character),
    })
    .onConflictDoNothing({ target: [t.characterSnapshots.characterId, t.characterSnapshots.capturedAt] })
    .returning({ id: t.characterSnapshots.id });
  return inserted.length;
}

/** Journalise un échec hors de la transaction annulée. Ne conserve aucune donnée du document. */
export async function recordFailedRun(
  db: Database,
  failure: { requestId: string; now: Date; machineUuid?: string; agentVersion?: string; schemaVersion?: number; code: string; message: string },
): Promise<void> {
  const [machine] = failure.machineUuid
    ? await db.select({ id: t.machines.id }).from(t.machines).where(eq(t.machines.machineUuid, failure.machineUuid))
    : [];
  const [run] = await db
    .insert(t.syncRuns)
    .values({
      machineId: machine?.id ?? null,
      requestId: failure.requestId,
      startedAt: failure.now,
      finishedAt: failure.now,
      status: "failed",
      errorsCount: 1,
      agentVersion: failure.agentVersion ?? null,
      schemaVersion: failure.schemaVersion ?? null,
    })
    .returning({ id: t.syncRuns.id });
  await db.insert(t.syncErrors).values({ syncRunId: run.id, code: failure.code, message: failure.message.slice(0, 500) });
}
