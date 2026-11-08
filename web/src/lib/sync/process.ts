import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { canonicalHash } from "@/lib/hash";
import { readSettings } from "@/lib/settings/store";
import { applyAuctionator, applyRecipes, emptyEconomyCounters, type EconomyCounters } from "./economy";
import type { AccountPayload, CharacterPayload, SyncPayload } from "./schema";

export type SyncResult = {
  runId: number;
  /** « partial » : l'agent a signalé des avertissements, conservés dans sync_errors. */
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

export type SyncContext = { tokenId: number; requestId: string; now: Date };

/** Le jeton présenté est déjà lié à une autre machine. */
export class TokenMachineMismatchError extends Error {
  constructor() {
    super("token is bound to another machine");
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Les synchronisations sont sérialisées : deux PC envoyant le même personnage au même instant
// ne peuvent pas se marcher dessus. Verrou de transaction, compatible PgBouncer. La
// réinitialisation des personnages prend le même.
export const SYNC_LOCK_KEY = 7_230_415_901;
const BATCH = 1_000;

const fromUnix = (seconds: number) => new Date(seconds * 1000);

function uniqueBy<T>(values: readonly T[], key: (value: T) => string | number): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

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

export async function processSync(db: Database, payload: SyncPayload, context: SyncContext): Promise<SyncResult> {
  const { now } = context;
  const started = Date.now();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SYNC_LOCK_KEY})`);

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
    }

    const warnings = payload.accounts.flatMap((account) =>
      account.warnings.map((message) => ({ syncRunId: run.id, accountKey: account.accountKey, code: "agent_warning", message })),
    );
    if (warnings.length > 0) await tx.insert(t.syncErrors).values(warnings);
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
    .values({ accountKey: account.accountKey, folderHint: account.folderHint, lastSyncAt: now })
    .onConflictDoUpdate({ target: t.wowAccounts.accountKey, set: { folderHint: account.folderHint, lastSyncAt: now, updatedAt: now } })
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

  const received = uniqueBy(account.characters, (character) => character.guid);
  counters.characters += received.length;
  if (received.length === 0) return accountId;

  const guids = received.map((character) => character.guid);
  const existingRows = await tx
    .select({
      id: t.characters.id,
      guid: t.characters.guid,
      sourceLastSeenAt: t.characters.sourceLastSeenAt,
      contentHash: t.characters.contentHash,
      statsAt: t.characters.statsAt,
      bagsAt: t.characters.bagsAt,
      bankAt: t.characters.bankAt,
    })
    .from(t.characters)
    .where(inArray(t.characters.guid, guids));
  const existing = new Map(existingRows.map((character) => [character.guid, character]));

  // Après une réinitialisation, un personnage inconnu et non vu en jeu depuis la date limite n'est
  // pas recréé : un PC qui garde un ancien fichier (celui de la bêta) le renvoie à chaque envoi.
  const cutoffMs = scope.cutoff?.getTime() ?? null;
  const characters = received.filter((character) => cutoffMs === null || existing.has(character.guid) || character.lastSeen * 1000 >= cutoffMs);
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
      await applyLedger(tx, characterId, character);
      counters.created++;
      counters.snapshots += await addSnapshot(tx, characterId, character, scope);
    } else {
      characterId = known.id;
      if (lastSeen.getTime() < known.sourceLastSeenAt.getTime()) {
        // Ce PC détient un fichier plus ancien que l'état déjà connu : on ne régresse pas.
        // Ses temps par niveau restent utiles : ils ont pu être relevés sur ce PC seulement.
        await applyLedger(tx, characterId, character);
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
        await applyLedger(tx, characterId, character);
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

type Blocks = { stats: boolean; bags: boolean; bank: boolean };

function identityColumns(character: CharacterPayload, accountId: number, realmId: number) {
  return {
    accountId,
    realmId,
    name: character.name,
    class: character.class ?? null,
    race: character.race ?? null,
    faction: character.faction ?? null,
    level: character.level ?? null,
    xp: character.xp ?? null,
    xpMax: character.xpMax ?? null,
    restedXp: character.restedXp ?? null,
    guild: character.guild ?? null,
    zone: character.zone ?? null,
    moneyCopper: character.moneyCopper ?? null,
    itemLevel: character.itemLevel ?? null,
    hidden: character.hidden,
  };
}

function blockColumns(character: CharacterPayload, blocks: Blocks) {
  return {
    ...(blocks.stats && character.stats ? { statsAt: character.statsAt === undefined ? null : fromUnix(character.statsAt) } : {}),
    ...(blocks.bags && character.bags
      ? { bagsAt: fromUnix(character.bags.at), bagSlotsUsed: character.bags.slotsUsed ?? null, bagSlotsTotal: character.bags.slotsTotal ?? null }
      : {}),
    ...(blocks.bank && character.bank
      ? { bankAt: fromUnix(character.bank.at), bankSlotsUsed: character.bank.slotsUsed ?? null, bankSlotsTotal: character.bank.slotsTotal ?? null }
      : {}),
  };
}

/** Remplace les tables filles du personnage par le contenu reçu (suppression puis insertion). */
async function replaceDetails(tx: Transaction, characterId: number, character: CharacterPayload, blocks: Blocks): Promise<void> {
  await tx.delete(t.characterProfessions).where(eq(t.characterProfessions.characterId, characterId));
  const professions = uniqueBy(character.professions, (p) => p.skillLine);
  if (professions.length > 0) {
    await tx.insert(t.characterProfessions).values(
      professions.map((p, position) => ({
        characterId,
        skillLine: p.skillLine,
        name: p.name,
        rank: p.rank ?? null,
        maxRank: p.max ?? null,
        isPrimary: p.primary,
        icon: p.icon ?? null,
        position,
      })),
    );
  }

  await tx.delete(t.characterEquipment).where(eq(t.characterEquipment.characterId, characterId));
  const gear = uniqueBy(character.gear, (g) => g.slot);
  if (gear.length > 0) {
    await tx.insert(t.characterEquipment).values(
      gear.map((g) => ({
        characterId,
        slot: g.slot,
        itemId: g.itemId ?? null,
        enchantId: g.enchantId ?? null,
        name: g.name ?? null,
        quality: g.quality ?? null,
        itemLevel: g.itemLevel ?? null,
        icon: g.icon ?? null,
        link: g.link ?? null,
      })),
    );
  }

  await tx.delete(t.characterReputations).where(eq(t.characterReputations.characterId, characterId));
  const reputations = uniqueBy(character.reputations, (r) => r.factionId);
  if (reputations.length > 0) {
    await tx.insert(t.characterReputations).values(
      reputations.map((r) => ({
        characterId,
        factionId: r.factionId,
        name: r.name,
        groupName: r.group ?? null,
        reaction: r.reaction ?? null,
        currentValue: r.current ?? null,
        minValue: r.min ?? null,
        maxValue: r.max ?? null,
      })),
    );
  }

  await tx.delete(t.characterCurrencies).where(eq(t.characterCurrencies.characterId, characterId));
  const currencies = uniqueBy(character.currencies, (c) => c.name);
  if (currencies.length > 0) {
    await tx.insert(t.characterCurrencies).values(
      currencies.map((c) => ({ characterId, name: c.name, quantity: c.quantity, maxQuantity: c.max ?? null, icon: c.icon ?? null })),
    );
  }

  if (blocks.stats && character.stats) {
    const s = character.stats;
    const stats = {
      strength: s.strength ?? null,
      agility: s.agility ?? null,
      stamina: s.stamina ?? null,
      intellect: s.intellect ?? null,
      spirit: s.spirit ?? null,
      armor: s.armor ?? null,
      health: s.health ?? null,
      power: s.power ?? null,
      powerType: s.powerType ?? null,
      attackPower: s.attackPower ?? null,
      rangedAttackPower: s.rangedAttackPower ?? null,
      crit: s.crit ?? null,
      rangedCrit: s.rangedCrit ?? null,
      hit: s.hit ?? null,
      dodge: s.dodge ?? null,
      parry: s.parry ?? null,
      block: s.block ?? null,
      defense: s.defense ?? null,
      spellPower: s.spellPower ?? null,
      spellCrit: s.spellCrit ?? null,
      healing: s.healing ?? null,
      spellHit: s.spellHit ?? null,
      resFire: s.resFire ?? null,
      resNature: s.resNature ?? null,
      resFrost: s.resFrost ?? null,
      resShadow: s.resShadow ?? null,
      resArcane: s.resArcane ?? null,
    };
    await tx
      .insert(t.characterStats)
      .values({ characterId, ...stats })
      .onConflictDoUpdate({ target: t.characterStats.characterId, set: stats });
  }

  for (const location of ["bags", "bank"] as const) {
    const container = character[location];
    if (!blocks[location] || !container) continue;
    await tx.delete(t.characterItems).where(and(eq(t.characterItems.characterId, characterId), eq(t.characterItems.location, location)));
    for (const batch of chunks(uniqueBy(container.items, (item) => item.key), BATCH)) {
      await tx.insert(t.characterItems).values(batch.map((item) => ({ characterId, location, itemKey: item.key, quantity: item.count })));
    }
  }
}

/** Données de l'addon Allemano Ledger : appliquées même quand le fichier AltBoard est en retard. */
async function applyLedger(tx: Transaction, characterId: number, character: CharacterPayload): Promise<void> {
  await applyPlaytime(tx, characterId, character);
  await applySessions(tx, characterId, character);
}

/**
 * Temps de jeu (Allemano Ledger). Les niveaux terminés sont des faits acquis : ils s'ajoutent et ne
 * sont jamais retirés, chaque PC ne connaissant que les niveaux gagnés chez lui. Le total et le
 * niveau en cours ne sont remplacés que par une mesure au moins aussi récente.
 */
async function applyPlaytime(tx: Transaction, characterId: number, character: CharacterPayload): Promise<void> {
  const playtime = character.playtime;
  if (!playtime) return;

  if (playtime.totalSeconds !== undefined || playtime.current) {
    const values = {
      totalSeconds: playtime.totalSeconds ?? null,
      measuredAt: playtime.measuredAt === undefined ? null : fromUnix(playtime.measuredAt),
      currentLevel: playtime.current?.level ?? null,
      currentLevelStartSeconds: playtime.current?.startTotalSeconds ?? null,
      currentLevelStartedAt: playtime.current?.startedAt === undefined ? null : fromUnix(playtime.current.startedAt),
    };
    await tx
      .insert(t.characterPlaytime)
      .values({ characterId, ...values })
      .onConflictDoUpdate({
        target: t.characterPlaytime.characterId,
        set: values,
        setWhere: sql`${t.characterPlaytime.measuredAt} is null or excluded.measured_at >= ${t.characterPlaytime.measuredAt}`,
      });
  }

  const levels = uniqueBy(playtime.levels, (entry) => entry.level);
  if (levels.length > 0) {
    await tx
      .insert(t.characterLevelTimes)
      .values(
        levels.map((entry) => ({
          characterId,
          level: entry.level,
          playedSeconds: entry.playedSeconds ?? null,
          wallSeconds: entry.wallSeconds ?? null,
          reachedAt: entry.reachedAt === undefined ? null : fromUnix(entry.reachedAt),
          zone: entry.zone ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [t.characterLevelTimes.characterId, t.characterLevelTimes.level],
        // Une valeur connue n'est jamais remplacée par une absence.
        set: {
          playedSeconds: sql`coalesce(excluded.played_seconds, ${t.characterLevelTimes.playedSeconds})`,
          wallSeconds: sql`coalesce(excluded.wall_seconds, ${t.characterLevelTimes.wallSeconds})`,
          reachedAt: sql`coalesce(excluded.reached_at, ${t.characterLevelTimes.reachedAt})`,
          zone: sql`coalesce(excluded.zone, ${t.characterLevelTimes.zone})`,
        },
      });
  }
}

/**
 * Sessions de jeu (Allemano Ledger), identifiées par leur début. Elles s'ajoutent et ne sont jamais
 * retirées : l'addon n'en garde que 50, et chaque PC ne connaît que les siennes. Une session
 * terminée remplace sa version provisoire. Une version provisoire n'en remplace une autre que si
 * elle est au moins aussi récente, et ne remplace jamais une session terminée.
 */
async function applySessions(tx: Transaction, characterId: number, character: CharacterPayload): Promise<void> {
  const sessions = uniqueBy(character.sessions ?? [], (entry) => entry.startedAt);
  if (sessions.length === 0) return;

  const stored = t.characterSessions;
  await tx
    .insert(stored)
    .values(
      sessions.map((entry) => ({
        characterId,
        startedAt: fromUnix(entry.startedAt),
        stoppedAt: entry.stoppedAt === undefined ? null : fromUnix(entry.stoppedAt),
        durationSeconds: entry.durationSeconds ?? null,
        xpGained: entry.xpGained ?? null,
        levels: entry.levels ?? null,
        zone: entry.zone ?? null,
        tag: entry.tag ?? null,
        inProgress: entry.inProgress,
      })),
    )
    .onConflictDoUpdate({
      target: [stored.characterId, stored.startedAt],
      // Une valeur connue n'est jamais remplacée par une absence.
      set: {
        stoppedAt: sql`coalesce(excluded.stopped_at, ${stored.stoppedAt})`,
        durationSeconds: sql`coalesce(excluded.duration_seconds, ${stored.durationSeconds})`,
        xpGained: sql`coalesce(excluded.xp_gained, ${stored.xpGained})`,
        levels: sql`coalesce(excluded.levels, ${stored.levels})`,
        zone: sql`coalesce(excluded.zone, ${stored.zone})`,
        tag: sql`coalesce(excluded.tag, ${stored.tag})`,
        inProgress: sql`excluded.in_progress`,
      },
      setWhere: sql`not excluded.in_progress or (${stored.inProgress} and (${stored.stoppedAt} is null or excluded.stopped_at >= ${stored.stoppedAt}))`,
    });
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
