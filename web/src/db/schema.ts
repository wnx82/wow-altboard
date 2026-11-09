import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Conventions : identifiants bigint générés, dates en timestamptz, argent en pièces de cuivre.
// Seules les colonnes alimentées par des données réellement observées dans AltBoard existent
// (voir docs/ALTBOARD-DATA-MODEL.md).

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Référentiel
// ---------------------------------------------------------------------------

export const machines = pgTable("machines", {
  id: id(),
  machineUuid: uuid("machine_uuid").notNull().unique(),
  hostname: text("hostname"),
  displayName: text("display_name"),
  agentVersion: text("agent_version"),
  firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Jeton d'agent : seul son SHA-256 est stocké. Lié à une machine à sa première utilisation.
export const agentTokens = pgTable("agent_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  machineId: bigint("machine_id", { mode: "number" }).references(() => machines.id),
  createdAt: createdAt(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const wowAccounts = pgTable("wow_accounts", {
  id: id(),
  // Empreinte stable du nom de dossier WTF\Account\<COMPTE> : identique sur tous les PC.
  accountKey: text("account_key").notNull().unique(),
  folderHint: text("folder_hint"),
  // Nom complet du dossier (« 123456789#1 »), envoyé depuis l'agent 0.6.0 ; null avant.
  folderName: text("folder_name"),
  displayName: text("display_name"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSyncAt: ts("last_sync_at"),
});

export const machineAccounts = pgTable(
  "machine_accounts",
  {
    machineId: bigint("machine_id", { mode: "number" })
      .notNull()
      .references(() => machines.id),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => wowAccounts.id),
    flavor: text("flavor"),
    addonSchema: integer("addon_schema"),
    addonVersion: text("addon_version"),
    lastFileHash: text("last_file_hash"),
    lastFileModifiedAt: ts("last_file_modified_at"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.accountId] })],
);

export const realms = pgTable("realms", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

// Référentiel d'objets issu de AltBoardDB.items, partagé par tous les personnages.
export const items = pgTable("items", {
  itemKey: text("item_key").primaryKey(),
  itemId: integer("item_id").notNull(),
  suffixId: integer("suffix_id"),
  name: text("name"),
  quality: smallint("quality"),
  icon: integer("icon"),
  link: text("link"),
  updatedAt: updatedAt(),
});

// Noms des objets du jeu, pour ceux qu'aucun personnage n'a possédés : l'hôtel des ventes et les
// recettes citent des objets absents de AltBoardDB.items. Repli seulement : le nom relevé par
// l'addon (items) l'emporte toujours. source : « wago » (table ItemSparse de wago.tools, importée
// depuis la page Paramètres) ou « client » (cache du jeu lu par l'agent) ; un import wago ne
// remplace jamais un nom « client ». build : version du jeu dont vient le nom.
export const itemNames = pgTable(
  "item_names",
  {
    itemId: integer("item_id").primaryKey(),
    name: text("name").notNull(),
    quality: smallint("quality"),
    source: text("source").notNull(),
    build: text("build").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [check("item_names_source_check", sql`${t.source} in ('wago', 'client')`)],
);

// ---------------------------------------------------------------------------
// Personnages
// ---------------------------------------------------------------------------

export const characters = pgTable(
  "characters",
  {
    id: id(),
    // GUID joueur (clé de AltBoardDB.chars) : seul identifiant fiable, le nom n'est pas unique.
    guid: text("guid").notNull().unique(),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => wowAccounts.id),
    realmId: bigint("realm_id", { mode: "number" })
      .notNull()
      .references(() => realms.id),
    name: text("name").notNull(),
    class: text("class"),
    race: text("race"),
    faction: text("faction"),
    level: smallint("level"),
    xp: integer("xp"),
    xpMax: integer("xp_max"),
    restedXp: integer("rested_xp"),
    guild: text("guild"),
    zone: text("zone"),
    moneyCopper: bigint("money_copper", { mode: "number" }),
    itemLevel: doublePrecision("item_level"),
    hidden: boolean("hidden").notNull().default(false),
    bagSlotsUsed: smallint("bag_slots_used"),
    bagSlotsTotal: smallint("bag_slots_total"),
    bankSlotsUsed: smallint("bank_slots_used"),
    bankSlotsTotal: smallint("bank_slots_total"),
    // Horodatages fournis par l'addon (lastSeen, statsAt, bagsAt, bankAt).
    sourceLastSeenAt: ts("source_last_seen_at").notNull(),
    statsAt: ts("stats_at"),
    bagsAt: ts("bags_at"),
    bankAt: ts("bank_at"),
    contentHash: text("content_hash").notNull(),
    lastMachineId: bigint("last_machine_id", { mode: "number" }).references(() => machines.id),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSyncAt: ts("last_sync_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("characters_account_id_idx").on(t.accountId),
    index("characters_realm_id_idx").on(t.realmId),
    check("characters_money_copper_check", sql`${t.moneyCopper} >= 0`),
  ],
);

const characterId = () =>
  bigint("character_id", { mode: "number" })
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" });

export const characterMachines = pgTable(
  "character_machines",
  {
    characterId: characterId(),
    machineId: bigint("machine_id", { mode: "number" })
      .notNull()
      .references(() => machines.id),
    sourceLastSeenAt: ts("source_last_seen_at").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.machineId] })],
);

export const characterStats = pgTable("character_stats", {
  characterId: characterId().primaryKey(),
  strength: integer("strength"),
  agility: integer("agility"),
  stamina: integer("stamina"),
  intellect: integer("intellect"),
  spirit: integer("spirit"),
  armor: integer("armor"),
  health: integer("health"),
  power: integer("power"),
  powerType: text("power_type"),
  attackPower: integer("attack_power"),
  rangedAttackPower: integer("ranged_attack_power"),
  crit: doublePrecision("crit"),
  rangedCrit: doublePrecision("ranged_crit"),
  hit: doublePrecision("hit"),
  dodge: doublePrecision("dodge"),
  parry: doublePrecision("parry"),
  block: doublePrecision("block"),
  defense: integer("defense"),
  spellPower: integer("spell_power"),
  spellCrit: doublePrecision("spell_crit"),
  healing: integer("healing"),
  spellHit: doublePrecision("spell_hit"),
  resFire: integer("res_fire"),
  resNature: integer("res_nature"),
  resFrost: integer("res_frost"),
  resShadow: integer("res_shadow"),
  resArcane: integer("res_arcane"),
});

export const characterProfessions = pgTable(
  "character_professions",
  {
    characterId: characterId(),
    skillLine: integer("skill_line").notNull(),
    name: text("name").notNull(),
    rank: integer("rank"),
    maxRank: integer("max_rank"),
    isPrimary: boolean("is_primary").notNull().default(false),
    icon: integer("icon"),
    position: smallint("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.skillLine] })],
);

export const characterEquipment = pgTable(
  "character_equipment",
  {
    characterId: characterId(),
    slot: smallint("slot").notNull(),
    itemId: integer("item_id"),
    enchantId: integer("enchant_id"),
    name: text("name"),
    quality: smallint("quality"),
    itemLevel: integer("item_level"),
    icon: integer("icon"),
    link: text("link"),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.slot] }),
    check("character_equipment_slot_check", sql`${t.slot} between 1 and 19`),
  ],
);

export const characterReputations = pgTable(
  "character_reputations",
  {
    characterId: characterId(),
    factionId: integer("faction_id").notNull(),
    name: text("name").notNull(),
    groupName: text("group_name"),
    reaction: smallint("reaction"),
    currentValue: integer("current_value"),
    minValue: integer("min_value"),
    maxValue: integer("max_value"),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.factionId] })],
);

// Clé = nom localisé : l'addon ne fournit pas d'identifiant de monnaie.
export const characterCurrencies = pgTable(
  "character_currencies",
  {
    characterId: characterId(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    maxQuantity: integer("max_quantity"),
    icon: integer("icon"),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.name] })],
);

// Sacs et banque. item_key référence items sans clé étrangère : un fichier partiel peut citer
// un objet absent du référentiel.
export const characterItems = pgTable(
  "character_items",
  {
    characterId: characterId(),
    location: text("location").notNull(),
    itemKey: text("item_key").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.location, t.itemKey] }),
    check("character_items_location_check", sql`${t.location} in ('bags', 'bank')`),
    check("character_items_quantity_check", sql`${t.quantity} >= 0`),
  ],
);

// Temps de jeu, issu de l'addon Allemano Ledger (voir docs/LEDGER-DATA-MODEL.md).
// Dernier /played connu et début du niveau en cours.
export const characterPlaytime = pgTable("character_playtime", {
  characterId: characterId().primaryKey(),
  totalSeconds: integer("total_seconds"),
  measuredAt: ts("measured_at"),
  currentLevel: smallint("current_level"),
  // /played total au moment où le niveau en cours a commencé.
  currentLevelStartSeconds: integer("current_level_start_seconds"),
  currentLevelStartedAt: ts("current_level_started_at"),
});

// Un niveau terminé : temps de jeu et temps réel passés pour aller de level à level + 1.
// played_seconds est absent quand plusieurs niveaux ont été gagnés d'un coup.
export const characterLevelTimes = pgTable(
  "character_level_times",
  {
    characterId: characterId(),
    level: smallint("level").notNull(),
    playedSeconds: integer("played_seconds"),
    wallSeconds: integer("wall_seconds"),
    reachedAt: ts("reached_at"),
    zone: text("zone"),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.level] }),
    check("character_level_times_seconds_check", sql`${t.playedSeconds} >= 0 and ${t.wallSeconds} >= 0`),
  ],
);

// Une session de jeu (Allemano Ledger), identifiée par son début. duration_seconds est le temps
// connecté, pauses exclues. in_progress : session encore ouverte au dernier relevé, donc valeurs
// provisoires. L'addon ne garde que 50 sessions : ici elles s'accumulent sans limite.
export const characterSessions = pgTable(
  "character_sessions",
  {
    characterId: characterId(),
    startedAt: ts("started_at").notNull(),
    stoppedAt: ts("stopped_at"),
    durationSeconds: integer("duration_seconds"),
    xpGained: integer("xp_gained"),
    levels: smallint("levels"),
    zone: text("zone"),
    tag: text("tag"),
    inProgress: boolean("in_progress").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.startedAt] }),
    check("character_sessions_values_check", sql`${t.durationSeconds} >= 0 and ${t.xpGained} >= 0 and ${t.levels} >= 0`),
  ],
);

/**
 * Finances d'un personnage par jour (Allemano Ledger, agent 0.7.0), par machine : chaque PC ne
 * connaît que les sessions jouées chez lui. day est la date locale du client de jeu. income et
 * expense : montant par source en pièces de cuivre (sources absentes : 0).
 */
export const characterLedgerDays = pgTable(
  "character_ledger_days",
  {
    characterId: characterId(),
    machineId: bigint("machine_id", { mode: "number" })
      .notNull()
      .references(() => machines.id),
    day: date("day", { mode: "string" }).notNull(),
    income: jsonb("income").$type<Record<string, number>>().notNull(),
    expense: jsonb("expense").$type<Record<string, number>>().notNull(),
    transferIn: bigint("transfer_in", { mode: "number" }).notNull().default(0),
    transferOut: bigint("transfer_out", { mode: "number" }).notNull().default(0),
    lootValue: bigint("loot_value", { mode: "number" }),
    gold: bigint("gold", { mode: "number" }),
    playedSeconds: integer("played_seconds"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.characterId, t.machineId, t.day] }),
    index("character_ledger_days_day_idx").on(t.day),
    check(
      "character_ledger_days_values_check",
      sql`${t.transferIn} >= 0 and ${t.transferOut} >= 0 and ${t.lootValue} >= 0 and ${t.gold} >= 0 and ${t.playedSeconds} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Journal des synchronisations
// ---------------------------------------------------------------------------

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    machineId: bigint("machine_id", { mode: "number" }).references(() => machines.id),
    requestId: text("request_id").notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    status: text("status").notNull(),
    accountsDetected: integer("accounts_detected").notNull().default(0),
    charactersDetected: integer("characters_detected").notNull().default(0),
    charactersCreated: integer("characters_created").notNull().default(0),
    charactersUpdated: integer("characters_updated").notNull().default(0),
    charactersUnchanged: integer("characters_unchanged").notNull().default(0),
    charactersStale: integer("characters_stale").notNull().default(0),
    snapshotsCreated: integer("snapshots_created").notNull().default(0),
    errorsCount: integer("errors_count").notNull().default(0),
    sourceHash: text("source_hash"),
    agentVersion: text("agent_version"),
    schemaVersion: integer("schema_version"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("sync_runs_machine_started_idx").on(t.machineId, t.startedAt),
    check("sync_runs_status_check", sql`${t.status} in ('success', 'partial', 'failed')`),
  ],
);

export const syncErrors = pgTable("sync_errors", {
  id: id(),
  syncRunId: bigint("sync_run_id", { mode: "number" })
    .notNull()
    .references(() => syncRuns.id, { onDelete: "cascade" }),
  accountKey: text("account_key"),
  characterGuid: text("character_guid"),
  code: text("code").notNull(),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

export const characterSnapshots = pgTable(
  "character_snapshots",
  {
    id: id(),
    characterId: characterId(),
    // = lastSeen de la source : rejouer la même synchronisation ne crée pas de doublon.
    capturedAt: ts("captured_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    syncRunId: bigint("sync_run_id", { mode: "number" }).references(() => syncRuns.id, {
      onDelete: "set null",
    }),
    snapshotHash: text("snapshot_hash").notNull(),
    level: smallint("level"),
    xp: integer("xp"),
    // Expérience du niveau : sans elle, xp ne se compare pas d'un niveau à l'autre.
    xpMax: integer("xp_max"),
    moneyCopper: bigint("money_copper", { mode: "number" }),
    itemLevel: doublePrecision("item_level"),
    restedXp: integer("rested_xp"),
    data: jsonb("data").notNull(),
  },
  (t) => [unique("character_snapshots_character_captured_key").on(t.characterId, t.capturedAt)],
);

// ---------------------------------------------------------------------------
// Marché : prix relevés par l'addon Auctionator (voir docs/AUCTIONATOR-DATA-MODEL.md)
// ---------------------------------------------------------------------------

// Un hôtel des ventes : la clé qu'Auctionator lui donne, dans un client donné. Sur WoW Forever,
// tous les royaumes d'une même règle partagent un hôtel des ventes (« PvE »). Le client fait partie
// de l'identité : la bêta avait elle aussi un hôtel des ventes « PvE », sans rapport avec celui-ci.
export const markets = pgTable(
  "markets",
  {
    id: id(),
    flavor: text("flavor").notNull(),
    auctionKey: text("auction_key").notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [unique("markets_flavor_auction_key_key").on(t.flavor, t.auctionKey)],
);

const marketId = () =>
  bigint("market_id", { mode: "number" })
    .notNull()
    .references(() => markets.id, { onDelete: "cascade" });

// Une version d'un relevé reçue d'un compte. Un relevé identique renvoyé n'est pas réimporté.
export const marketImports = pgTable(
  "market_imports",
  {
    id: id(),
    marketId: marketId(),
    accountId: bigint("account_id", { mode: "number" })
      .notNull()
      .references(() => wowAccounts.id),
    machineId: bigint("machine_id", { mode: "number" }).references(() => machines.id),
    syncRunId: bigint("sync_run_id", { mode: "number" }).references(() => syncRuns.id, { onDelete: "set null" }),
    contentHash: text("content_hash").notNull(),
    fileHash: text("file_hash").notNull(),
    fileModifiedAt: ts("file_modified_at").notNull(),
    itemsCount: integer("items_count").notNull(),
    observationsCount: integer("observations_count").notNull(),
    firstDay: date("first_day", { mode: "string" }),
    lastDay: date("last_day", { mode: "string" }),
    receivedAt: ts("received_at").notNull().defaultNow(),
  },
  (t) => [
    unique("market_imports_market_account_content_key").on(t.marketId, t.accountId, t.contentHash),
    index("market_imports_market_received_idx").on(t.marketId, t.receivedAt),
  ],
);

// Un objet, un jour : plus bas et plus haut des prix minimums vus ce jour-là, à l'unité, en pièces
// de cuivre, et plus grande quantité en vente. Plusieurs comptes et PC relèvent le même jour :
// les valeurs se fusionnent (plus bas des plus bas, plus haut des plus hauts, plus grande quantité),
// ce qui rend l'import idempotent.
export const marketItemDays = pgTable(
  "market_item_days",
  {
    marketId: marketId(),
    itemKey: text("item_key").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    lowCopper: bigint("low_copper", { mode: "number" }).notNull(),
    highCopper: bigint("high_copper", { mode: "number" }).notNull(),
    available: integer("available"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.marketId, t.itemKey, t.day] }),
    index("market_item_days_market_day_idx").on(t.marketId, t.day),
    check("market_item_days_values_check", sql`${t.lowCopper} >= 0 and ${t.lowCopper} <= ${t.highCopper} and ${t.available} >= 0`),
  ],
);

// Dernier prix minimum vu par objet (champ m d'Auctionator), daté du jour de son relevé.
export const marketItemLatest = pgTable(
  "market_item_latest",
  {
    marketId: marketId(),
    itemKey: text("item_key").notNull(),
    minCopper: bigint("min_copper", { mode: "number" }).notNull(),
    day: date("day", { mode: "string" }).notNull(),
    // Date du fichier qui l'a fourni : départage deux relevés du même jour.
    observedAt: ts("observed_at").notNull(),
    importId: bigint("import_id", { mode: "number" }).references(() => marketImports.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.itemKey] }), check("market_item_latest_min_check", sql`${t.minCopper} > 0`)],
);

// Prix d'achat chez un marchand (stock illimité), à l'unité : prix de la pile divisé par sa taille,
// donc pas toujours entier. Relevé par Auctionator à l'ouverture d'un marchand.
export const vendorPrices = pgTable(
  "vendor_prices",
  {
    itemKey: text("item_key").primaryKey(),
    priceCopper: doublePrecision("price_copper").notNull(),
    observedAt: ts("observed_at").notNull(),
  },
  (t) => [check("vendor_prices_price_check", sql`${t.priceCopper} > 0`)],
);

// ---------------------------------------------------------------------------
// Recettes : relevées par l'addon NaowhForever (voir docs/PROFESSIONS-DATA-MODEL.md)
// ---------------------------------------------------------------------------

// Une recette, identifiée par son sort de métier. Données du jeu : objet produit, quantité produite.
export const recipes = pgTable(
  "recipes",
  {
    spellId: integer("spell_id").primaryKey(),
    skillLine: integer("skill_line"),
    outputItemId: integer("output_item_id").notNull(),
    outputQuantity: integer("output_quantity").notNull(),
    cooldown: boolean("cooldown").notNull().default(false),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [index("recipes_output_item_idx").on(t.outputItemId), check("recipes_output_quantity_check", sql`${t.outputQuantity} >= 1`)],
);

export const recipeReagents = pgTable(
  "recipe_reagents",
  {
    spellId: integer("spell_id")
      .notNull()
      .references(() => recipes.spellId, { onDelete: "cascade" }),
    itemId: integer("item_id").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.spellId, t.itemId] }),
    index("recipe_reagents_item_idx").on(t.itemId),
    check("recipe_reagents_quantity_check", sql`${t.quantity} >= 1`),
  ],
);

// Recettes apprises par un personnage, telles que le dernier fichier NaowhForever les décrit.
export const characterRecipes = pgTable(
  "character_recipes",
  {
    characterId: characterId(),
    spellId: integer("spell_id")
      .notNull()
      .references(() => recipes.spellId),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.spellId] }), index("character_recipes_spell_idx").on(t.spellId)],
);

// Fichier qui a fourni la liste d'un personnage : un PC au fichier plus ancien ne la remplace pas.
export const characterRecipeSources = pgTable("character_recipe_sources", {
  characterId: characterId().primaryKey(),
  fileModifiedAt: ts("file_modified_at").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Sessions de farm : inventaire relevé au début et à la fin, valorisé au marché
// ---------------------------------------------------------------------------

export const farmSessions = pgTable(
  "farm_sessions",
  {
    id: id(),
    characterId: characterId(),
    label: text("label"),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
    // Horodatage des sacs (bagsAt d'AltBoard) au début et à la fin : la durée mesurée en jeu.
    startSourceAt: ts("start_source_at").notNull(),
    endSourceAt: ts("end_source_at"),
    startMoneyCopper: bigint("start_money_copper", { mode: "number" }),
    endMoneyCopper: bigint("end_money_copper", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("farm_sessions_character_started_idx").on(t.characterId, t.startedAt),
    // Une seule session ouverte par personnage, garanti par la base même sous requêtes concurrentes.
    uniqueIndex("farm_sessions_open_character_idx").on(t.characterId).where(sql`${t.endedAt} is null`),
    check("farm_sessions_end_check", sql`${t.endSourceAt} is null or ${t.endSourceAt} > ${t.startSourceAt}`),
  ],
);

export const farmSessionItems = pgTable(
  "farm_session_items",
  {
    sessionId: bigint("session_id", { mode: "number" })
      .notNull()
      .references(() => farmSessions.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    location: text("location").notNull(),
    itemKey: text("item_key").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.phase, t.location, t.itemKey] }),
    check("farm_session_items_phase_check", sql`${t.phase} in ('start', 'end')`),
    check("farm_session_items_location_check", sql`${t.location} in ('bags', 'bank')`),
    check("farm_session_items_quantity_check", sql`${t.quantity} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Recommandations : chaque calcul des opportunités est conservé, avec ses entrées
// ---------------------------------------------------------------------------

// Un calcul, fait sur l'état du marché après un import donné. Les paramètres et les entrées de
// chaque recommandation y sont gardés tels qu'utilisés : on peut la refaire et la contester.
export const opportunityRuns = pgTable(
  "opportunity_runs",
  {
    id: id(),
    marketId: marketId(),
    computedAt: ts("computed_at").notNull(),
    lastImportId: bigint("last_import_id", { mode: "number" }).references(() => marketImports.id, { onDelete: "set null" }),
    dataThrough: date("data_through", { mode: "string" }),
    engineVersion: text("engine_version").notNull(),
    parameters: jsonb("parameters").notNull(),
    opportunitiesCount: integer("opportunities_count").notNull(),
  },
  (t) => [index("opportunity_runs_market_computed_idx").on(t.marketId, t.computedAt)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => opportunityRuns.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    kind: text("kind").notNull(),
    itemKey: text("item_key"),
    spellId: integer("spell_id"),
    valueCopper: bigint("value_copper", { mode: "number" }),
    confidence: smallint("confidence").notNull(),
    horizon: text("horizon").notNull(),
    reasonCodes: text("reason_codes").array().notNull(),
    inputs: jsonb("inputs").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.rank] }),
    check("opportunities_kind_check", sql`${t.kind} in ('CRAFT', 'PROCESS', 'DONT_CRAFT', 'SELL', 'KEEP', 'BUY', 'FARM')`),
    check("opportunities_confidence_check", sql`${t.confidence} between 0 and 100`),
  ],
);

// Audit du jour rédigé par l'assistant (web/src/lib/economy/daily-audit.ts), à partir des seuls faits
// du moteur : un par marché et par jour (Europe/Brussels), réécrit à la demande. run_id : le calcul
// dont viennent ses faits.
export const economyAudits = pgTable(
  "economy_audits",
  {
    id: id(),
    marketId: marketId(),
    day: date("day", { mode: "string" }).notNull(),
    runId: bigint("run_id", { mode: "number" }).references(() => opportunityRuns.id, { onDelete: "set null" }),
    dataThrough: date("data_through", { mode: "string" }),
    model: text("model").notNull(),
    text: text("text").notNull(),
    writtenAt: ts("written_at").notNull(),
  },
  (t) => [unique("economy_audits_market_day_key").on(t.marketId, t.day)],
);

// Alerte de prix posée sur un objet d'un marché (web/src/lib/economy/alerts.ts) : déclenchée quand
// le dernier prix relevé (market_item_latest) passe sous le seuil (below) ou au-dessus (above).
// Aucun état n'est conservé : l'alerte se relit à chaque affichage, sans notification.
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: id(),
    marketId: marketId(),
    itemKey: text("item_key").notNull(),
    direction: text("direction").notNull(),
    thresholdCopper: bigint("threshold_copper", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("price_alerts_market_item_direction_key").on(t.marketId, t.itemKey, t.direction),
    check("price_alerts_direction_check", sql`${t.direction} in ('below', 'above')`),
    check("price_alerts_threshold_check", sql`${t.thresholdCopper} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Objectifs par personnage
// ---------------------------------------------------------------------------

// Sorte d'un objectif (web/src/lib/goals/evaluate.ts) : « manual » se coche à la main, les autres
// seuls, à la synchronisation. params : { target, subject } selon la sorte.
const goalKind = (name: string) => text(name).notNull();
const goalKindCheck = (column: unknown) =>
  sql`${column} in ('manual', 'level', 'profession', 'reputation', 'item', 'gold', 'itemLevel', 'currency')`;

// Modèles : des listes à réappliquer, qui survivent à la réinitialisation des personnages.
export const goalTemplates = pgTable("goal_templates", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const goalTemplateItems = pgTable(
  "goal_template_items",
  {
    id: id(),
    templateId: bigint("template_id", { mode: "number" })
      .notNull()
      .references(() => goalTemplates.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    kind: goalKind("kind"),
    params: jsonb("params").notNull().default({}),
  },
  (t) => [index("goal_template_items_template_idx").on(t.templateId, t.position), check("goal_template_items_kind_check", goalKindCheck(t.kind))],
);

// achieved_at : date d'atteinte. Un objectif automatique atteint une fois le reste.
export const characterGoals = pgTable(
  "character_goals",
  {
    id: id(),
    characterId: characterId(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    kind: goalKind("kind"),
    params: jsonb("params").notNull().default({}),
    achievedAt: ts("achieved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("character_goals_character_idx").on(t.characterId, t.position), check("character_goals_kind_check", goalKindCheck(t.kind))],
);

// ---------------------------------------------------------------------------
// Surveillance des serveurs de jeu
// ---------------------------------------------------------------------------

// Un contrôle d'un service par ce serveur (voir docs/SERVER-STATUS.md). Rien n'est écrit tant
// qu'aucune adresse n'est configurée : l'absence de ligne est une absence de mesure.
export const serverStatusChecks = pgTable(
  "server_status_checks",
  {
    id: id(),
    checkedAt: ts("checked_at").notNull(),
    service: text("service").notNull(),
    status: text("status").notNull(),
    // Ce qui a été constaté, plus fin que le statut : refus, délai dépassé, DNS…
    outcome: text("outcome").notNull(),
    // Adresse la plus rapide à répondre ; absente quand aucune ne répond.
    latencyMs: integer("latency_ms"),
    targetsUp: smallint("targets_up").notNull(),
    targetsTotal: smallint("targets_total").notNull(),
    source: text("source").notNull(),
    error: text("error"),
  },
  (t) => [
    index("server_status_checks_service_checked_idx").on(t.service, t.checkedAt),
    check("server_status_checks_service_check", sql`${t.service} in ('auth', 'game')`),
    check("server_status_checks_status_check", sql`${t.status} in ('up', 'degraded', 'down', 'unknown')`),
    check("server_status_checks_targets_check", sql`${t.targetsUp} >= 0 and ${t.targetsUp} <= ${t.targetsTotal}`),
  ],
);

// ---------------------------------------------------------------------------
// Réglages du site
// ---------------------------------------------------------------------------

// Réglages de la page Paramètres. Une seule ligne (id = 1), créée à la première écriture : son
// absence vaut « tout par défaut ».
export const appSettings = pgTable(
  "app_settings",
  {
    id: smallint("id").primaryKey().default(1),
    // Adresses surveillées, « hôte:port » séparées par des virgules. Null : celles de
    // l'environnement du serveur s'appliquent ; chaîne vide : rien n'est surveillé.
    statusAuthTargets: text("status_auth_targets"),
    statusGameTargets: text("status_game_targets"),
    // Environnement affiché à côté des serveurs (« Bêta », « EU »). Null : libellé par défaut.
    statusLabel: text("status_label"),
    // Un personnage non vu en jeu depuis cette date est supprimé par la réinitialisation, puis
    // ignoré par les synchronisations tant qu'il est inconnu (voir docs/API.md).
    charactersCutoffAt: ts("characters_cutoff_at"),
    charactersResetAt: ts("characters_reset_at"),
    // Prix ignorés avant cette date (économie de la bêta). Null : la date limite des personnages.
    marketHistoryFrom: ts("market_history_from"),
    // Commission de l'hôtel des ventes en pourcentage du prix de vente. Null : 5 %.
    auctionCutPercent: doublePrecision("auction_cut_percent"),
    updatedAt: updatedAt(),
  },
  (t) => [check("app_settings_single_row_check", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// Accès au tableau de bord
// ---------------------------------------------------------------------------

export const adminUsers = pgTable("admin_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastLoginAt: ts("last_login_at"),
});

// Session : seul le SHA-256 de l'identifiant de session est stocké.
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);
