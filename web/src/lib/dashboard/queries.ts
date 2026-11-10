import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import type { ActivitySnapshot } from "./activity";
import type { LedgerDayRow } from "./finances";
import type { MoneySnapshot } from "./gold-history";
import type { PlaytimeRow, SessionFact } from "./playtime";
import type { ReputationRow } from "./reputations";
import type { LevelRow } from "./levels";

// Chaque page lit ses données en un nombre fixe de requêtes, indépendant du nombre de personnages.

export type Named = { id: number; label: string };
/** Compte d'un personnage ; `featured` : mis en avant à l'accueil. */
export type AccountRef = Named & { featured: boolean };

export const accountLabel = (account: { displayName: string | null; folderHint: string | null }) =>
  account.displayName ?? `Compte ${account.folderHint ?? "inconnu"}`;

export const machineLabel = (machine: { displayName: string | null; hostname: string | null }) =>
  machine.displayName ?? machine.hostname ?? "Machine inconnue";

export type CharacterListItem = {
  id: number;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  xp: number | null;
  xpMax: number | null;
  guild: string | null;
  zone: string | null;
  moneyCopper: number | null;
  itemLevel: number | null;
  hidden: boolean;
  account: AccountRef;
  machines: Named[];
  professions: { skillLine: number; name: string; rank: number | null; maxRank: number | null; isPrimary: boolean }[];
  /** Objectifs atteints (datés) sur le total ; total 0 sans objectif. */
  goals: { done: number; total: number };
  /** Dernière collecte par l'addon (lastSeen) : la donnée n'est jamais du temps réel. */
  sourceLastSeenAt: string;
  lastSyncAt: string;
};

export async function listCharacters(db: Database): Promise<CharacterListItem[]> {
  const rows = await db
    .select({
      id: t.characters.id,
      name: t.characters.name,
      realm: t.realms.name,
      class: t.characters.class,
      race: t.characters.race,
      faction: t.characters.faction,
      level: t.characters.level,
      xp: t.characters.xp,
      xpMax: t.characters.xpMax,
      guild: t.characters.guild,
      zone: t.characters.zone,
      moneyCopper: t.characters.moneyCopper,
      itemLevel: t.characters.itemLevel,
      hidden: t.characters.hidden,
      accountId: t.wowAccounts.id,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
      accountFeatured: t.wowAccounts.featured,
      sourceLastSeenAt: t.characters.sourceLastSeenAt,
      lastSyncAt: t.characters.lastSyncAt,
    })
    .from(t.characters)
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
    .orderBy(desc(t.characters.level), asc(t.characters.name));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [professions, machines, goals] = await Promise.all([
    db
      .select({
        characterId: t.characterProfessions.characterId,
        skillLine: t.characterProfessions.skillLine,
        name: t.characterProfessions.name,
        rank: t.characterProfessions.rank,
        maxRank: t.characterProfessions.maxRank,
        isPrimary: t.characterProfessions.isPrimary,
      })
      .from(t.characterProfessions)
      .where(inArray(t.characterProfessions.characterId, ids))
      .orderBy(asc(t.characterProfessions.characterId), asc(t.characterProfessions.position)),
    db
      .select({
        characterId: t.characterMachines.characterId,
        id: t.machines.id,
        displayName: t.machines.displayName,
        hostname: t.machines.hostname,
      })
      .from(t.characterMachines)
      .innerJoin(t.machines, eq(t.machines.id, t.characterMachines.machineId))
      .where(inArray(t.characterMachines.characterId, ids))
      .orderBy(asc(t.machines.id)),
    db
      .select({
        characterId: t.characterGoals.characterId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(${t.characterGoals.achievedAt})::int`,
      })
      .from(t.characterGoals)
      .where(inArray(t.characterGoals.characterId, ids))
      .groupBy(t.characterGoals.characterId),
  ]);

  const professionsBy = Map.groupBy(professions, (profession) => profession.characterId);
  const machinesBy = Map.groupBy(machines, (machine) => machine.characterId);
  const goalsBy = new Map(goals.map((row) => [row.characterId, { done: row.done, total: row.total }]));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    realm: row.realm,
    class: row.class,
    race: row.race,
    faction: row.faction,
    level: row.level,
    xp: row.xp,
    xpMax: row.xpMax,
    guild: row.guild,
    zone: row.zone,
    moneyCopper: row.moneyCopper,
    itemLevel: row.itemLevel,
    hidden: row.hidden,
    account: {
      id: row.accountId,
      label: accountLabel({ displayName: row.accountDisplayName, folderHint: row.accountFolderHint }),
      featured: row.accountFeatured,
    },
    machines: (machinesBy.get(row.id) ?? []).map((machine) => ({ id: machine.id, label: machineLabel(machine) })),
    professions: (professionsBy.get(row.id) ?? []).map(({ skillLine, name, rank, maxRank, isPrimary }) => ({ skillLine, name, rank, maxRank, isPrimary })),
    goals: goalsBy.get(row.id) ?? { done: 0, total: 0 },
    sourceLastSeenAt: row.sourceLastSeenAt.toISOString(),
    lastSyncAt: row.lastSyncAt.toISOString(),
  }));
}

export type LastSync = { at: string; machine: string; status: string } | null;

export type Overview = { accounts: number; machines: number; lastSync: LastSync };

export async function getOverview(db: Database): Promise<Overview> {
  const [[accounts], [machines], [last]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(t.wowAccounts),
    db.select({ count: sql<number>`count(*)::int` }).from(t.machines),
    db
      .select({
        at: t.syncRuns.startedAt,
        status: t.syncRuns.status,
        displayName: t.machines.displayName,
        hostname: t.machines.hostname,
      })
      .from(t.syncRuns)
      .leftJoin(t.machines, eq(t.machines.id, t.syncRuns.machineId))
      .where(eq(t.syncRuns.status, "success"))
      .orderBy(desc(t.syncRuns.startedAt))
      .limit(1),
  ]);
  return {
    accounts: accounts.count,
    machines: machines.count,
    lastSync: last ? { at: last.at.toISOString(), machine: machineLabel(last), status: last.status } : null,
  };
}

/** Sessions de jeu lues pour une fiche : les plus récentes. */
export const SESSIONS_SHOWN = 100;

export async function getCharacterDetail(db: Database, id: number) {
  const [character] = await db
    .select({
      character: t.characters,
      realm: t.realms.name,
      accountId: t.wowAccounts.id,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
      machineDisplayName: t.machines.displayName,
      machineHostname: t.machines.hostname,
    })
    .from(t.characters)
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
    .leftJoin(t.machines, eq(t.machines.id, t.characters.lastMachineId))
    .where(eq(t.characters.id, id));
  if (!character) return null;

  const [stats, professions, equipment, reputations, currencies, items, snapshots, playtime, levelTimes, sessions] = await Promise.all([
    db.select().from(t.characterStats).where(eq(t.characterStats.characterId, id)),
    db.select().from(t.characterProfessions).where(eq(t.characterProfessions.characterId, id)).orderBy(asc(t.characterProfessions.position)),
    db.select().from(t.characterEquipment).where(eq(t.characterEquipment.characterId, id)).orderBy(asc(t.characterEquipment.slot)),
    db
      .select()
      .from(t.characterReputations)
      .where(eq(t.characterReputations.characterId, id))
      .orderBy(asc(t.characterReputations.groupName), asc(t.characterReputations.name)),
    db.select().from(t.characterCurrencies).where(eq(t.characterCurrencies.characterId, id)).orderBy(asc(t.characterCurrencies.name)),
    db
      .select({
        location: t.characterItems.location,
        itemKey: t.characterItems.itemKey,
        quantity: t.characterItems.quantity,
        name: t.items.name,
        quality: t.items.quality,
      })
      .from(t.characterItems)
      .leftJoin(t.items, eq(t.items.itemKey, t.characterItems.itemKey))
      .where(eq(t.characterItems.characterId, id))
      .orderBy(desc(t.items.quality), asc(t.items.name)),
    db
      .select()
      .from(t.characterSnapshots)
      .where(eq(t.characterSnapshots.characterId, id))
      .orderBy(desc(t.characterSnapshots.capturedAt))
      .limit(200),
    db.select().from(t.characterPlaytime).where(eq(t.characterPlaytime.characterId, id)),
    db.select().from(t.characterLevelTimes).where(eq(t.characterLevelTimes.characterId, id)).orderBy(asc(t.characterLevelTimes.level)),
    db
      .select()
      .from(t.characterSessions)
      .where(eq(t.characterSessions.characterId, id))
      .orderBy(desc(t.characterSessions.startedAt))
      .limit(SESSIONS_SHOWN),
  ]);

  return {
    ...character.character,
    realm: character.realm,
    account: { id: character.accountId, label: accountLabel({ displayName: character.accountDisplayName, folderHint: character.accountFolderHint }) },
    lastMachine: character.machineHostname === null && character.machineDisplayName === null
      ? null
      : machineLabel({ displayName: character.machineDisplayName, hostname: character.machineHostname }),
    stats: stats[0] ?? null,
    professions,
    equipment,
    reputations,
    currencies,
    bags: items.filter((item) => item.location === "bags"),
    bank: items.filter((item) => item.location === "bank"),
    // Du plus ancien au plus récent, pour les courbes et le calcul des changements.
    snapshots: snapshots.reverse(),
    playtime: playtime[0] ?? null,
    levelTimes,
    // De la plus ancienne à la plus récente.
    sessions: sessions.reverse(),
  };
}

export type CharacterDetail = NonNullable<Awaited<ReturnType<typeof getCharacterDetail>>>;

/** Période couverte par la page Activité. */
export const ACTIVITY_DAYS = 30;

/** Le dernier relevé de chaque personnage avant `since`. */
const lastSnapshotBefore = (since: Date) => sql`${t.characterSnapshots.id} in (
    select distinct on (earlier.character_id) earlier.id
    from ${t.characterSnapshots} earlier
    where earlier.captured_at < ${since.toISOString()}::timestamptz
    order by earlier.character_id, earlier.captured_at desc
  )`;

/** Or de chaque relevé depuis `since`, plus le dernier relevé d'avant de chaque personnage (valeur de départ). */
export async function listMoneySnapshots(db: Database, since: Date): Promise<MoneySnapshot[]> {
  return db
    .select({ characterId: t.characterSnapshots.characterId, capturedAt: t.characterSnapshots.capturedAt, moneyCopper: t.characterSnapshots.moneyCopper })
    .from(t.characterSnapshots)
    .where(or(gte(t.characterSnapshots.capturedAt, since), lastSnapshotBefore(since)))
    .orderBy(asc(t.characterSnapshots.capturedAt));
}

/**
 * Relevés de tous les personnages depuis `since`, plus, pour chacun, le dernier relevé d'avant :
 * sans lui, le premier changement de la période n'aurait rien à quoi se comparer.
 */
export async function listRecentSnapshots(db: Database, since: Date): Promise<ActivitySnapshot[]> {
  const lastBefore = lastSnapshotBefore(since);
  const rows = await db
    .select({
      capturedAt: t.characterSnapshots.capturedAt,
      level: t.characterSnapshots.level,
      moneyCopper: t.characterSnapshots.moneyCopper,
      itemLevel: t.characterSnapshots.itemLevel,
      data: t.characterSnapshots.data,
      id: t.characters.id,
      name: t.characters.name,
      class: t.characters.class,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
    })
    .from(t.characterSnapshots)
    .innerJoin(t.characters, eq(t.characters.id, t.characterSnapshots.characterId))
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .where(or(gte(t.characterSnapshots.capturedAt, since), lastBefore))
    .orderBy(asc(t.characterSnapshots.characterId), asc(t.characterSnapshots.capturedAt));

  return rows.map(({ id, name, class: classToken, accountDisplayName, accountFolderHint, ...snapshot }) => ({
    ...snapshot,
    character: { id, name, class: classToken, account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }) },
  }));
}

/**
 * Niveau et expérience de chaque relevé depuis `since` (null : depuis toujours), plus, pour chaque
 * personnage, son dernier relevé d'avant : le point de départ de sa courbe. Par personnage, du plus
 * ancien au plus récent. Sans la colonne `data` des relevés, de loin la plus lourde.
 */
export async function listLevelSnapshots(db: Database, since: Date | null): Promise<LevelRow[]> {
  const rows = await db
    .select({
      characterId: t.characters.id,
      name: t.characters.name,
      class: t.characters.class,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
      capturedAt: t.characterSnapshots.capturedAt,
      level: t.characterSnapshots.level,
      xp: t.characterSnapshots.xp,
      xpMax: t.characterSnapshots.xpMax,
    })
    .from(t.characterSnapshots)
    .innerJoin(t.characters, eq(t.characters.id, t.characterSnapshots.characterId))
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .where(
      and(
        isNotNull(t.characterSnapshots.level),
        since === null ? undefined : or(gte(t.characterSnapshots.capturedAt, since), lastSnapshotBefore(since)),
      ),
    )
    .orderBy(asc(t.characterSnapshots.characterId), asc(t.characterSnapshots.capturedAt));

  return rows.map(({ accountDisplayName, accountFolderHint, level, ...row }) => ({
    ...row,
    level: level!,
    account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }),
  }));
}

export async function listAccounts(db: Database) {
  const [accounts, seenBy] = await Promise.all([
    db
      .select({
        id: t.wowAccounts.id,
        displayName: t.wowAccounts.displayName,
        folderHint: t.wowAccounts.folderHint,
        folderName: t.wowAccounts.folderName,
        featured: t.wowAccounts.featured,
        lastSyncAt: t.wowAccounts.lastSyncAt,
        characters: sql<number>`count(${t.characters.id})::int`,
        maxLevel: sql<number | null>`max(${t.characters.level})::int`,
        totalCopper: sql<number>`coalesce(sum(${t.characters.moneyCopper}), 0)::float8`,
      })
      .from(t.wowAccounts)
      .leftJoin(t.characters, eq(t.characters.accountId, t.wowAccounts.id))
      .groupBy(t.wowAccounts.id)
      .orderBy(asc(t.wowAccounts.id)),
    db
      .select({
        accountId: t.machineAccounts.accountId,
        machineId: t.machines.id,
        displayName: t.machines.displayName,
        hostname: t.machines.hostname,
        flavor: t.machineAccounts.flavor,
        addonVersion: t.machineAccounts.addonVersion,
        lastSeenAt: t.machineAccounts.lastSeenAt,
      })
      .from(t.machineAccounts)
      .innerJoin(t.machines, eq(t.machines.id, t.machineAccounts.machineId))
      .orderBy(asc(t.machines.id)),
  ]);
  const seenByAccount = Map.groupBy(seenBy, (row) => row.accountId);
  return accounts.map((account) => ({
    ...account,
    label: accountLabel(account),
    machines: (seenByAccount.get(account.id) ?? []).map((row) => ({
      id: row.machineId,
      label: machineLabel(row),
      flavor: row.flavor,
      addonVersion: row.addonVersion,
      lastSeenAt: row.lastSeenAt,
    })),
  }));
}

export async function listMachines(db: Database) {
  const [machines, tokens] = await Promise.all([
    db
      .select({
        id: t.machines.id,
        machineUuid: t.machines.machineUuid,
        displayName: t.machines.displayName,
        hostname: t.machines.hostname,
        agentVersion: t.machines.agentVersion,
        firstSeenAt: t.machines.firstSeenAt,
        lastSeenAt: t.machines.lastSeenAt,
        accounts: sql<number>`(select count(*)::int from ${t.machineAccounts} where ${t.machineAccounts.machineId} = ${t.machines.id})`,
        characters: sql<number>`(select count(*)::int from ${t.characterMachines} where ${t.characterMachines.machineId} = ${t.machines.id})`,
      })
      .from(t.machines)
      .orderBy(desc(t.machines.lastSeenAt)),
    db.select().from(t.agentTokens).orderBy(desc(t.agentTokens.createdAt)),
  ]);
  const tokensByMachine = Map.groupBy(tokens.filter((token) => token.machineId !== null), (token) => token.machineId!);
  return {
    machines: machines.map((machine) => ({ ...machine, label: machineLabel(machine), tokens: tokensByMachine.get(machine.id) ?? [] })),
    // Jetons créés mais jamais utilisés : pas encore liés à une machine.
    pendingTokens: tokens.filter((token) => token.machineId === null),
  };
}

/** Erreurs et avertissements affichés sous une synchronisation du journal ; le reste est compté. */
export const RUN_ERRORS_SHOWN = 10;

export async function listRecentRuns(db: Database, limit = 15) {
  const runs = await db
    .select({
      id: t.syncRuns.id,
      startedAt: t.syncRuns.startedAt,
      status: t.syncRuns.status,
      durationMs: t.syncRuns.durationMs,
      accountsDetected: t.syncRuns.accountsDetected,
      charactersDetected: t.syncRuns.charactersDetected,
      charactersCreated: t.syncRuns.charactersCreated,
      charactersUpdated: t.syncRuns.charactersUpdated,
      charactersUnchanged: t.syncRuns.charactersUnchanged,
      charactersStale: t.syncRuns.charactersStale,
      snapshotsCreated: t.syncRuns.snapshotsCreated,
      errorsCount: t.syncRuns.errorsCount,
      agentVersion: t.syncRuns.agentVersion,
      machineDisplayName: t.machines.displayName,
      machineHostname: t.machines.hostname,
    })
    .from(t.syncRuns)
    .leftJoin(t.machines, eq(t.machines.id, t.syncRuns.machineId))
    .orderBy(desc(t.syncRuns.startedAt))
    .limit(limit);

  const errors =
    runs.length === 0
      ? []
      : await db
          .select({ syncRunId: t.syncErrors.syncRunId, code: t.syncErrors.code, message: t.syncErrors.message })
          .from(t.syncErrors)
          .where(inArray(t.syncErrors.syncRunId, runs.map((run) => run.id)))
          .orderBy(asc(t.syncErrors.id));
  const byRun = new Map<number, { code: string; message: string }[]>();
  for (const { syncRunId, ...error } of errors) {
    const list = byRun.get(syncRunId) ?? [];
    if (list.length < RUN_ERRORS_SHOWN) list.push(error);
    byRun.set(syncRunId, list);
  }
  return runs.map((run) => ({ ...run, errors: byRun.get(run.id) ?? [] }));
}

export type ReputationCharacter = { id: number; name: string; class: string | null; level: number | null; account: string };

/** Réputations de tous les personnages, rangés par niveau décroissant. */
export async function listReputationRows(db: Database): Promise<ReputationRow<ReputationCharacter>[]> {
  const rows = await db
    .select({
      factionId: t.characterReputations.factionId,
      name: t.characterReputations.name,
      groupName: t.characterReputations.groupName,
      reaction: t.characterReputations.reaction,
      currentValue: t.characterReputations.currentValue,
      minValue: t.characterReputations.minValue,
      maxValue: t.characterReputations.maxValue,
      id: t.characters.id,
      characterName: t.characters.name,
      class: t.characters.class,
      level: t.characters.level,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
    })
    .from(t.characterReputations)
    .innerJoin(t.characters, eq(t.characters.id, t.characterReputations.characterId))
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .orderBy(desc(t.characters.level), asc(t.characters.name));
  return rows.map(({ id, characterName, class: classToken, level, accountDisplayName, accountFolderHint, ...reputation }) => ({
    ...reputation,
    character: { id, name: characterName, class: classToken, level, account: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }) },
  }));
}

/** Dernier /played connu de chaque personnage, avec son compte ; null si jamais mesuré. */
export async function listPlaytimeRows(db: Database): Promise<PlaytimeRow[]> {
  const rows = await db
    .select({
      characterId: t.characters.id,
      accountId: t.wowAccounts.id,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
      totalSeconds: t.characterPlaytime.totalSeconds,
    })
    .from(t.characters)
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .leftJoin(t.characterPlaytime, eq(t.characterPlaytime.characterId, t.characters.id));
  return rows.map(({ accountDisplayName, accountFolderHint, ...row }) => ({
    ...row,
    accountLabel: accountLabel({ displayName: accountDisplayName, folderHint: accountFolderHint }),
  }));
}

/** Sessions de tous les personnages commencées depuis `since`. */
export async function listSessionFacts(db: Database, since: Date): Promise<SessionFact[]> {
  return db
    .select({
      characterId: t.characterSessions.characterId,
      startedAt: t.characterSessions.startedAt,
      durationSeconds: t.characterSessions.durationSeconds,
      xpGained: t.characterSessions.xpGained,
      levels: t.characterSessions.levels,
      tag: t.characterSessions.tag,
    })
    .from(t.characterSessions)
    .where(gte(t.characterSessions.startedAt, since))
    .orderBy(asc(t.characterSessions.startedAt));
}

export type FinanceCharacter = { id: number; name: string; class: string | null; account: string };

/** Journées d'Allemano Ledger depuis `from` (tout l'historique si null), et les personnages concernés. */
export async function listLedgerDays(db: Database, from: string | null): Promise<{ rows: LedgerDayRow[]; characters: Map<number, FinanceCharacter> }> {
  const days = t.characterLedgerDays;
  const rows = await db
    .select({
      characterId: days.characterId,
      machineId: days.machineId,
      day: days.day,
      income: days.income,
      expense: days.expense,
      transferIn: days.transferIn,
      transferOut: days.transferOut,
      lootValue: days.lootValue,
      playedSeconds: days.playedSeconds,
      name: t.characters.name,
      class: t.characters.class,
      accountDisplayName: t.wowAccounts.displayName,
      accountFolderHint: t.wowAccounts.folderHint,
    })
    .from(days)
    .innerJoin(t.characters, eq(t.characters.id, days.characterId))
    .innerJoin(t.wowAccounts, eq(t.wowAccounts.id, t.characters.accountId))
    .where(from === null ? undefined : gte(days.day, from))
    .orderBy(asc(days.day), asc(days.characterId), asc(days.machineId));

  const characters = new Map<number, FinanceCharacter>();
  for (const row of rows) {
    if (!characters.has(row.characterId)) {
      characters.set(row.characterId, {
        id: row.characterId,
        name: row.name,
        class: row.class,
        account: accountLabel({ displayName: row.accountDisplayName, folderHint: row.accountFolderHint }),
      });
    }
  }
  return {
    rows: rows.map((row) => ({
      characterId: row.characterId,
      machineId: row.machineId,
      day: row.day,
      income: row.income,
      expense: row.expense,
      transferIn: row.transferIn,
      transferOut: row.transferOut,
      lootValue: row.lootValue,
      playedSeconds: row.playedSeconds,
    })),
    characters,
  };
}

/** Une journée d'Allemano Ledger existe-t-elle, toutes périodes confondues ? */
export async function hasLedgerDays(db: Database): Promise<boolean> {
  const [row] = await db.select({ day: t.characterLedgerDays.day }).from(t.characterLedgerDays).limit(1);
  return row !== undefined;
}
