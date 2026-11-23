import * as z from "zod";
import { sha256Hex } from "@/lib/hash";

// Contrat de POST /api/sync, version 1. Miroir de agent/src/AltBoardSync.Core/Sync/SyncPayload.cs.
// Objets stricts : tout champ inconnu fait refuser le document. Toute évolution incompatible
// passe par une nouvelle valeur de schemaVersion.

export const SUPPORTED_SCHEMA_VERSION = 1;

// PostgreSQL refuse l'octet nul dans un texte : il est rejeté ici plutôt qu'en pleine transaction.
const text = (max: number) => z.string().min(1).max(max).regex(/^[^\u0000]*$/);
const name = text(120);
const link = text(600);
const int = z.int();
const nonNegativeInt = z.int().min(0);
const int32 = z.int().min(-2_147_483_648).max(2_147_483_647);
const count = z.int().min(0).max(2_147_483_647);
const unixSeconds = z.int().min(1).max(32_503_680_000); // jusqu'à l'an 3000
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const itemKey = z.string().regex(/^\d{1,9}(:-?\d{1,9})?$/);

// Textes informatifs (avertissements de l'agent, nom donné au PC) : trop longs ou trop nombreux,
// ils sont raccourcis plutôt que de faire refuser tout le document, qui emporterait les données
// de tous les comptes du PC. Les autres limites restent strictes.
export const MAX_WARNINGS = 50;
const WARNING_LENGTH = 400;
/** Ramène un texte à `max` unités (la mesure de zod), « … » en dernier, sans couper un caractère en deux. */
const shorten = (max: number) => (value: unknown) => {
  if (typeof value !== "string" || value.length <= max) return value;
  const kept = value.slice(0, max - 1);
  return `${/[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept}…`;
};
const warnings = z.preprocess((value) => {
  if (!Array.isArray(value) || value.length <= MAX_WARNINGS) return value;
  return [...value.slice(0, MAX_WARNINGS - 1), `${value.length - MAX_WARNINGS + 1} autres avertissements non transmis`];
}, z.array(z.preprocess(shorten(WARNING_LENGTH), text(WARNING_LENGTH))).max(MAX_WARNINGS));
const finite = z.number();
const instant = z.iso.datetime({ offset: true });

const stats = z.strictObject({
  strength: int32.optional(),
  agility: int32.optional(),
  stamina: int32.optional(),
  intellect: int32.optional(),
  spirit: int32.optional(),
  armor: int32.optional(),
  health: int32.optional(),
  power: int32.optional(),
  powerType: name.optional(),
  attackPower: int32.optional(),
  rangedAttackPower: int32.optional(),
  crit: finite.optional(),
  rangedCrit: finite.optional(),
  hit: finite.optional(),
  dodge: finite.optional(),
  parry: finite.optional(),
  block: finite.optional(),
  defense: int32.optional(),
  spellPower: int32.optional(),
  spellCrit: finite.optional(),
  healing: int32.optional(),
  spellHit: finite.optional(),
  resFire: int32.optional(),
  resNature: int32.optional(),
  resFrost: int32.optional(),
  resShadow: int32.optional(),
  resArcane: int32.optional(),
});

const gear = z.strictObject({
  slot: z.int().min(1).max(19),
  itemId: count.optional(),
  enchantId: count.optional(),
  name: name.optional(),
  quality: z.int().min(0).max(32_767).optional(),
  itemLevel: int32.optional(),
  icon: int32.optional(),
  link: link.optional(),
});

const profession = z.strictObject({
  skillLine: count,
  name,
  rank: int32.optional(),
  max: int32.optional(),
  primary: z.boolean(),
  icon: int32.optional(),
});

const reputation = z.strictObject({
  factionId: z.int().min(1).max(2_147_483_647),
  name,
  group: name.optional(),
  reaction: z.int().min(-32_768).max(32_767).optional(),
  current: int32.optional(),
  min: int32.optional(),
  max: int32.optional(),
});

const currency = z.strictObject({
  name,
  quantity: count,
  max: int32.optional(),
  icon: int32.optional(),
});

const container = z.strictObject({
  at: unixSeconds,
  slotsUsed: z.int().min(0).max(32_767).optional(),
  slotsTotal: z.int().min(0).max(32_767).optional(),
  items: z.array(z.strictObject({ key: itemKey, count })).max(5_000),
});

// Temps de jeu relevé par l'addon Allemano Ledger (facultatif : absent si l'addon n'est pas installé).
const level = z.int().min(0).max(32_767);
const playtime = z.strictObject({
  totalSeconds: count.optional(),
  measuredAt: unixSeconds.optional(),
  current: z.strictObject({ level, startTotalSeconds: count.optional(), startedAt: unixSeconds.optional() }).optional(),
  levels: z
    .array(z.strictObject({ level, playedSeconds: count.optional(), wallSeconds: count.optional(), reachedAt: unixSeconds.optional(), zone: name.optional() }))
    .max(200),
});

// Sessions de jeu relevées par Allemano Ledger, identifiées par leur début. durationSeconds est le
// temps connecté, pauses exclues. inProgress : session encore ouverte quand le jeu a écrit le
// fichier, donc valeurs provisoires. L'addon garde 50 sessions par personnage, plus celle en cours.
const session = z.strictObject({
  startedAt: unixSeconds,
  stoppedAt: unixSeconds.optional(),
  durationSeconds: count.optional(),
  xpGained: count.optional(),
  levels: level.optional(),
  zone: name.optional(),
  tag: text(40).optional(),
  inProgress: z.boolean(),
});

// Donjons et autres « runs » relevés par Allemano Ledger, envoyés depuis l'agent 0.11.0 : chacun
// recoupe la session qui le contient, il n'est donc pas compté dans les sessions. Identifiés par
// leur début. Argent et gain net en pièces de cuivre, négatifs quand le run a coûté.
const signedCopper = z.int().min(-10_000_000_000_000).max(10_000_000_000_000);
const run = z.strictObject({
  startedAt: unixSeconds,
  stoppedAt: unixSeconds.optional(),
  durationSeconds: count.optional(),
  zone: text(80).optional(),
  tag: text(40).optional(),
  xpGained: count.optional(),
  levels: level.optional(),
  moneyCopper: signedCopper.optional(),
  netCopper: signedCopper.optional(),
  lootValueCopper: z.int().min(0).max(10_000_000_000_000).optional(),
});

// Finances par jour relevées par Allemano Ledger, envoyées depuis l'agent 0.7.0. Jour : date locale
// du client de jeu. Montants en pièces de cuivre ; une source absente vaut 0. Les transferts entre
// personnages du même joueur ne sont ni des revenus ni des dépenses.
export const INCOME_SOURCES = ["loot", "vendor", "quest", "ah", "mail", "trade", "other"] as const;
export const EXPENSE_SOURCES = ["repair", "vendor", "training", "travel", "ah", "mail", "trade", "other"] as const;
const ledgerCopper = z.int().min(0).max(10_000_000_000_000);
const amounts = <const T extends readonly string[]>(sources: T) =>
  z.strictObject(Object.fromEntries(sources.map((source) => [source, ledgerCopper.optional()])) as { [K in T[number]]: z.ZodOptional<typeof ledgerCopper> });
const ledgerDay = z.strictObject({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((day) => {
      const date = new Date(`${day}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
    }, { message: "date invalide" }),
  income: amounts(INCOME_SOURCES),
  expense: amounts(EXPENSE_SOURCES),
  transferIn: ledgerCopper,
  transferOut: ledgerCopper,
  lootValue: ledgerCopper.optional(),
  gold: ledgerCopper.optional(),
  playedSeconds: count.optional(),
});

const character = z.strictObject({
  guid: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name,
  realm: name,
  lastSeen: unixSeconds,
  class: name.optional(),
  race: name.optional(),
  faction: name.optional(),
  level: z.int().min(0).max(32_767).optional(),
  xp: nonNegativeInt.max(2_147_483_647).optional(),
  xpMax: nonNegativeInt.max(2_147_483_647).optional(),
  restedXp: nonNegativeInt.max(2_147_483_647).optional(),
  guild: name.optional(),
  zone: name.optional(),
  moneyCopper: nonNegativeInt.optional(),
  itemLevel: finite.optional(),
  hidden: z.boolean(),
  stats: stats.optional(),
  statsAt: unixSeconds.optional(),
  gear: z.array(gear).max(19),
  professions: z.array(profession).max(32),
  reputations: z.array(reputation).max(1_000),
  currencies: z.array(currency).max(1_000),
  bags: container.optional(),
  bank: container.optional(),
  playtime: playtime.optional(),
  sessions: z.array(session).max(60).optional(),
  // Facultatif : un agent antérieur à 0.11.0 ne l'envoie pas.
  runs: z
    .array(run)
    .max(60)
    .refine((runs) => new Set(runs.map((r) => r.startedAt)).size === runs.length, { message: "run en double" })
    .optional(),
  finances: z
    .array(ledgerDay)
    .max(800)
    .refine((days) => new Set(days.map((d) => d.day)).size === days.length, { message: "jour en double" })
    .optional(),
});

const item = z.strictObject({
  key: itemKey,
  itemId: count,
  suffixId: int32.optional(),
  name: name.optional(),
  quality: z.int().min(0).max(32_767).optional(),
  icon: int32.optional(),
  link: link.optional(),
});

const sourceFile = z.strictObject({ hash: sha256, modifiedAt: instant, size: nonNegativeInt });

// Auctionator (voir docs/AUCTIONATOR-DATA-MODEL.md). Jour Auctionator : 0 = 2020-01-01.
const auctionDay = z.int().min(0).max(40_000);
const copper = z.int().min(0).max(10_000_000_000_000);
const marketItemKey = z.string().regex(/^(\d{1,9}|g:\d{1,9}:\d{1,5}|p:\d{1,9})$/);
const marketDay = z
  .tuple([auctionDay, copper, copper, z.int().min(0).max(1_000_000_000).nullable()])
  .refine(([, low, high]) => low <= high, { message: "low must not exceed high" });

const marketItem = z.strictObject({
  key: marketItemKey,
  lastMin: copper.min(1).optional(),
  days: z.array(marketDay).min(1).max(400),
});

const market = z.strictObject({
  key: text(120),
  contentHash: sha256,
  items: z.array(marketItem).max(100_000),
});

const auctionator = z.strictObject({
  file: sourceFile,
  dbVersion: z.int().min(0).max(1_000),
  markets: z.array(market).max(20),
  vendorPrices: z.array(z.strictObject({ key: marketItemKey, price: z.number().positive().max(10_000_000_000_000) })).max(100_000),
});

// EZAuctioneer (voir docs/EZAUCTIONEER-DATA-MODEL.md), envoyé depuis l'agent 0.10.0. Heures en
// secondes Unix, à l'heure du serveur du jeu, du 2020-01-01 au 2100-01-01.
const scanInstant = z.int().min(1_577_836_800).max(4_102_444_800);
export const SCAN_ITEM_KEY_PATTERN = /^i:(\d{1,9})(?::s-?\d{1,9}(?::f\d{1,5})?)?$/;
export const SCAN_MARKET_KEY_PATTERN = /^(\d{1,4}|\?):([^\u0000-\u001f]{1,80}):(?:([^:\u0000-\u001f]{1,40}):faction|neutral)$/;
const scanCount = z.int().min(0).max(1_000_000_000);
const scanMarket = z.strictObject({
  key: z.string().max(120).regex(SCAN_MARKET_KEY_PATTERN),
  contentHash: sha256,
  scans: z
    .array(
      z.strictObject({
        at: scanInstant,
        auctions: scanCount.optional(),
        items: scanCount.optional(),
        origin: z.string().regex(/^[a-z][a-z0-9_-]{0,19}$/).optional(),
      }),
    )
    .max(50),
  items: z
    .array(
      z.strictObject({
        key: z.string().regex(SCAN_ITEM_KEY_PATTERN),
        // [heure, prix au 25e percentile pondéré par les unités, unités en vente]
        samples: z.array(z.tuple([scanInstant, copper.min(1), scanCount])).min(1).max(50),
      }),
    )
    .max(20_000),
});

// Portefeuille de revente d'EZAuctioneer, par personnage (« <région>:<royaume>:<personnage> », le
// royaume vide quand l'addon ne le connaissait pas encore), envoyé depuis l'agent 0.11.0 : bilan
// cumulé, positions détenues, annonces suivies, journal (l'addon en garde 200 entrées).
export const PORTFOLIO_KEY_PATTERN = /^(\d{1,4}|\?):([^:\u0000-\u001f]{0,80}):([^:\u0000-\u001f]{1,40})$/;
export const RESALE_EVENT_KINDS = ["buy", "post", "sale", "pending", "expire", "cancel", "unknown", "remove"] as const;
const scanItemKey = z.string().regex(SCAN_ITEM_KEY_PATTERN);
const portfolio = z.strictObject({
  key: z.string().max(160).regex(PORTFOLIO_KEY_PATTERN),
  stats: z.strictObject({ realized: signedCopper, sales: count, cuts: copper, expired: count, depositsLost: copper, unknown: count }),
  positions: z
    .array(z.strictObject({ key: scanItemKey, qty: count, cost: copper, listed: count, openedAt: scanInstant.optional() }))
    .max(500)
    .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length, { message: "position en double" }),
  auctions: z
    .array(
      z.strictObject({
        id: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
        key: scanItemKey,
        qty: count.min(1),
        unit: copper,
        deposit: copper.optional(),
        cut: z.number().min(0).max(1).optional(),
        market: text(120).optional(),
        postedAt: scanInstant.optional(),
      }),
    )
    .max(500)
    .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, { message: "annonce en double" }),
  log: z
    .array(
      z.strictObject({
        at: scanInstant,
        kind: z.enum(RESALE_EVENT_KINDS),
        key: scanItemKey,
        qty: count,
        amount: copper.optional(),
        fee: copper.optional(),
        gain: signedCopper.optional(),
        unit: copper.optional(),
        deposit: copper.optional(),
        source: z.string().regex(/^[\p{L}\p{N} _-]{1,20}$/u).optional(),
      }),
    )
    .max(300),
});

// Affaires repérées par EZAuctioneer au dernier scan de chaque marché (lastDeals, 150 au plus),
// dans l'ordre de l'addon. resale : prix de revente visé, à l'unité ; profit et roi : estimés en jeu.
const deals = z.strictObject({
  market: z.string().max(120).regex(SCAN_MARKET_KEY_PATTERN),
  at: scanInstant.optional(),
  entries: z
    .array(
      z.strictObject({
        key: scanItemKey,
        kind: z.enum(["resale", "vendor"]),
        source: text(20).optional(),
        qty: count.min(1),
        cost: copper,
        resale: copper,
        profit: signedCopper,
        roi: z.number().min(-1_000).max(1_000),
        listings: count.optional(),
        thin: z.boolean().optional(),
        live: z.enum(["live", "gone", "checking"]).optional(),
      }),
    )
    .max(150),
});

const ezAuctioneer = z.strictObject({
  file: sourceFile,
  schema: z.int().min(0).max(1_000),
  markets: z.array(scanMarket).max(20),
  // Facultatifs : un agent antérieur à 0.11.0 ne les envoie pas.
  portfolios: z
    .array(portfolio)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length, { message: "portefeuille en double" })
    .optional(),
  deals: z
    .array(deals)
    .max(20)
    .refine((rows) => new Set(rows.map((r) => r.market)).size === rows.length, { message: "marché en double" })
    .optional(),
});

// NaowhForever (voir docs/PROFESSIONS-DATA-MODEL.md).
const positiveId = z.int().min(1).max(2_147_483_647);
const recipe = z.strictObject({
  spellId: positiveId,
  skillLine: positiveId.optional(),
  outputItemId: positiveId,
  outputQuantity: z.int().min(1).max(10_000),
  cooldown: z.boolean(),
  reagents: z.array(z.strictObject({ itemId: positiveId, quantity: z.int().min(1).max(10_000) })).min(1).max(20),
});

const recipes = z.strictObject({
  file: sourceFile,
  characters: z
    .array(z.strictObject({ guid: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), recipes: z.array(recipe).max(2_000) }))
    .max(200),
});

// Courrier, enchères en cours et banques de guilde relevés par l'addon Baganator (Syndicator.lua),
// envoyés depuis l'agent 0.8.0. Chaque personnage d'AltBoard que Baganator connaît figure, listes
// vides comprises : un courrier retiré disparaît.
const holding = z.strictObject({ key: itemKey, count, expiresAt: unixSeconds.optional() });
const baganator = z.strictObject({
  file: sourceFile,
  characters: z
    .array(
      z.strictObject({
        guid: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
        mail: z.array(holding).max(2_000),
        auctions: z.array(holding).max(2_000),
      }),
    )
    .max(200),
  guilds: z
    .array(
      z.strictObject({
        name,
        realm: name,
        moneyCopper: z.int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
        tabs: z
          .array(
            z.strictObject({
              index: z.int().min(1).max(16),
              name: text(60).optional(),
              items: z.array(z.strictObject({ key: itemKey, count })).max(500),
            }),
          )
          .max(16),
      }),
    )
    .max(50),
});

/** Empreinte d'un nom de dossier de compte, calculée comme AccountKey.Compute dans l'agent. */
export const accountKeyOf = (folderName: string) => sha256Hex(`wow-altboard-account:${folderName.trim().toUpperCase()}`);

const account = z
  .strictObject({
    accountKey: sha256,
    folderHint: text(16),
    // Nom complet du dossier WTF\Account (« 123456789#1 »), envoyé depuis l'agent 0.6.0. ASCII imprimable
    // seulement : l'agent ne l'envoie pas sinon, et l'empreinte se recalcule ici à l'identique.
    folderName: z.string().regex(/^[!-~]{1,64}$/).optional(),
    flavor: text(40),
    addonSchema: int.min(0).max(1_000_000).optional(),
    addonVersion: text(40).optional(),
    file: sourceFile,
    characters: z.array(character).max(200),
    items: z.array(item).max(50_000),
    warnings,
    // Informations sans gravité (personnages vus par Baganator mais pas par AltBoard…) : gardées comme
    // les avertissements, sans rendre la synchronisation partielle. Facultatives : un agent antérieur
    // à 0.9.0 ne les envoie pas.
    notices: warnings.optional(),
    // Facultatifs : un agent antérieur à 0.5.0 ne les envoie pas.
    auctionator: auctionator.optional(),
    recipes: recipes.optional(),
    // Facultatif : un agent antérieur à 0.8.0 ne l'envoie pas.
    baganator: baganator.optional(),
    // Facultatif : un agent antérieur à 0.10.0 ne l'envoie pas.
    ezAuctioneer: ezAuctioneer.optional(),
    // Erreurs Lua gardées par l'addon AltBoard (AltBoardDB.errors, 10 au plus), envoyées depuis l'agent
    // 0.11.0. Une liste vide efface les précédentes ; absente (agent plus ancien), elles restent.
    addonErrors: z
      .array(z.strictObject({ at: unixSeconds, where: z.preprocess(shorten(80), text(80)), message: z.preprocess(shorten(400), text(400)), version: text(40).optional() }))
      .max(10)
      .optional(),
  })
  .refine((a) => a.folderName === undefined || accountKeyOf(a.folderName) === a.accountKey, {
    message: "nom de dossier sans rapport avec l'empreinte du compte",
    path: ["folderName"],
  });

export const syncPayloadSchema = z.strictObject({
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION),
  agentVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][0-9A-Za-z.-]{1,40})?$/),
  generatedAt: instant,
  machine: z.strictObject({
    uuid: z.uuid(),
    hostname: text(120),
    displayName: z.preprocess(shorten(120), text(120)).optional(),
  }),
  accounts: z.array(account).max(50),
  // Noms d'objets du cache local d'un client (DBCache.bin), envoyés depuis l'agent 0.7.0 quand ce
  // cache a changé. Un client par entrée.
  itemNames: z
    .array(
      z.strictObject({
        flavor: text(40),
        locale: z.string().regex(/^[a-z]{2}[A-Z]{2}$/),
        build: positiveId,
        file: sourceFile,
        names: z.array(z.strictObject({ id: positiveId, name: text(200) })).max(100_000),
      }),
    )
    .max(10)
    .optional(),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;
export type ItemNamesPayload = NonNullable<SyncPayload["itemNames"]>[number];
export type LedgerDayPayload = NonNullable<CharacterPayload["finances"]>[number];
export type AccountPayload = SyncPayload["accounts"][number];
export type CharacterPayload = AccountPayload["characters"][number];
export type ItemPayload = AccountPayload["items"][number];
export type AuctionatorPayload = NonNullable<AccountPayload["auctionator"]>;
export type MarketPayload = AuctionatorPayload["markets"][number];
export type RecipesPayload = NonNullable<AccountPayload["recipes"]>;
export type EzAuctioneerPayload = NonNullable<AccountPayload["ezAuctioneer"]>;
export type ScanMarketPayload = EzAuctioneerPayload["markets"][number];
export type PortfolioPayload = NonNullable<EzAuctioneerPayload["portfolios"]>[number];
export type DealsPayload = NonNullable<EzAuctioneerPayload["deals"]>[number];
export type RunPayload = NonNullable<CharacterPayload["runs"]>[number];
export type AddonErrorPayload = NonNullable<AccountPayload["addonErrors"]>[number];
export type BaganatorPayload = NonNullable<AccountPayload["baganator"]>;
