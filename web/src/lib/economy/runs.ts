import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { canonicalJson } from "@/lib/hash";
import * as t from "@/db/schema";
import { loadItemNames } from "./item-names";
import type { EconomyContext } from "./load";
import { buildOpportunities, DEFAULT_PARAMETERS, ENGINE_VERSION, type Opportunity, type OpportunityKind } from "./opportunities";

// Conservation des calculs d'opportunités. Un calcul n'est refait que si sa base a changé : un
// nouvel import de prix, une nouvelle synchronisation (stocks, recettes), une autre version du
// moteur ou d'autres paramètres. Chaque recommandation garde ainsi la trace de ce qui l'a produite.

export type OpportunityRun = {
  id: number;
  computedAt: Date;
  dataThrough: string | null;
  engineVersion: string;
  opportunities: Opportunity[];
  reused: boolean;
};

type Basis = { lastImportId: number | null; lastSyncRunId: number | null };

function parametersOf(context: EconomyContext) {
  return { ...DEFAULT_PARAMETERS, auctionCut: context.auctionCut, historyFrom: context.historyFrom, today: context.today };
}

export async function ensureOpportunityRun(db: Database, context: EconomyContext, now: Date): Promise<OpportunityRun> {
  const parameters = parametersOf(context);
  const basis: Basis = { lastImportId: context.newestImportId, lastSyncRunId: context.lastSyncRunId };

  const [previous] = await db
    .select()
    .from(t.opportunityRuns)
    .where(eq(t.opportunityRuns.marketId, context.market.id))
    .orderBy(desc(t.opportunityRuns.id))
    .limit(1);
  const previousParameters = previous?.parameters as ({ basis?: Basis } & Record<string, unknown>) | undefined;
  if (
    previous &&
    previous.engineVersion === ENGINE_VERSION &&
    previous.lastImportId === basis.lastImportId &&
    previousParameters?.basis?.lastSyncRunId === basis.lastSyncRunId &&
    // JSONB réordonne les clés : comparaison sur une forme canonique.
    canonicalJson({ ...previousParameters, basis: undefined }) === canonicalJson(parameters)
  ) {
    return { ...(await readRun(db, previous.id))!, reused: true };
  }

  const list = buildOpportunities(context.stats, context.crafts, context.stock, context.farmSignals, parameters);
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(t.opportunityRuns)
      .values({
        marketId: context.market.id,
        computedAt: now,
        lastImportId: basis.lastImportId,
        dataThrough: context.lastImport?.lastDay ?? null,
        engineVersion: ENGINE_VERSION,
        parameters: { ...parameters, basis },
        opportunitiesCount: list.length,
      })
      .returning({ id: t.opportunityRuns.id });
    if (list.length > 0) {
      await tx.insert(t.opportunities).values(
        list.map((o, index) => ({
          runId: run.id,
          rank: index + 1,
          kind: o.kind,
          itemKey: o.itemKey,
          spellId: o.spellId,
          valueCopper: o.valueCopper,
          confidence: o.confidence,
          horizon: o.horizon,
          reasonCodes: o.reasonCodes,
          inputs: o.inputs,
        })),
      );
    }
    return { id: run.id, computedAt: now, dataThrough: context.lastImport?.lastDay ?? null, engineVersion: ENGINE_VERSION, opportunities: list, reused: false };
  });
}

export async function readRun(db: Database, runId: number): Promise<Omit<OpportunityRun, "reused"> | null> {
  const [run] = await db.select().from(t.opportunityRuns).where(eq(t.opportunityRuns.id, runId));
  if (!run) return null;
  const rows = await db.select().from(t.opportunities).where(eq(t.opportunities.runId, runId)).orderBy(asc(t.opportunities.rank));
  return {
    id: run.id,
    computedAt: run.computedAt,
    dataThrough: run.dataThrough,
    engineVersion: run.engineVersion,
    opportunities: rows.map((row) => ({
      kind: row.kind as OpportunityKind,
      itemKey: row.itemKey,
      spellId: row.spellId,
      valueCopper: row.valueCopper ?? 0,
      confidence: row.confidence,
      horizon: row.horizon as Opportunity["horizon"],
      reasonCodes: row.reasonCodes,
      inputs: row.inputs as Record<string, unknown>,
    })),
  };
}

export async function listRuns(db: Database, marketId: number, limit = 20) {
  return db
    .select({
      id: t.opportunityRuns.id,
      computedAt: t.opportunityRuns.computedAt,
      dataThrough: t.opportunityRuns.dataThrough,
      engineVersion: t.opportunityRuns.engineVersion,
      opportunitiesCount: t.opportunityRuns.opportunitiesCount,
      lastImportId: t.opportunityRuns.lastImportId,
    })
    .from(t.opportunityRuns)
    .where(and(eq(t.opportunityRuns.marketId, marketId)))
    .orderBy(desc(t.opportunityRuns.id))
    .limit(limit);
}

/** Dernier calcul conservé, tous marchés confondus, et ses premières opportunités de gain. Rien n'est recalculé. */
export async function latestOpportunities(db: Database, limit = 3) {
  const [last] = await db.select({ id: t.opportunityRuns.id }).from(t.opportunityRuns).orderBy(desc(t.opportunityRuns.id)).limit(1);
  if (!last) return null;
  const run = (await readRun(db, last.id))!;
  const top = run.opportunities.filter((o) => o.kind !== "DONT_CRAFT").slice(0, limit);
  const keys = top.flatMap((o) => (o.itemKey ? [o.itemKey] : []));
  return { run, top, names: await loadItemNames(db, keys) };
}
