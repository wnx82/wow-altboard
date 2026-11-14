import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { invalidateEconomyCache } from "../lib/economy/cache";
import { createDatabase, createPool, type Database } from "./client";
import { testDatabaseUrl } from "./env";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

export type TestDatabase = { db: Database; pool: Pool; reset: () => Promise<void>; close: () => Promise<void> };

const TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table as PgTable)}"`);

/**
 * Base réservée aux tests d'intégration. testDatabaseUrl() refuse toute base dont le nom n'est
 * pas wow_altboard*_test : ces tests vident les tables.
 */
export async function openTestDatabase(): Promise<TestDatabase> {
  const url = testDatabaseUrl();
  await runMigrations(url);
  const pool = createPool(url);
  const db = createDatabase(pool);
  return {
    db,
    pool,
    reset: async () => {
      await db.execute(sql.raw(`truncate table ${TABLES.join(", ")} restart identity cascade`));
      // Identifiants remis à zéro : une clé du cache de l'économie pourrait reparaître à l'identique.
      invalidateEconomyCache();
    },
    close: () => pool.end(),
  };
}

export async function countRows(db: Database, table: PgTable): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return row.count;
}
