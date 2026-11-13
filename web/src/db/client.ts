import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { appDatabaseUrl } from "./env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
// Base ou transaction en cours : les fonctions d'écriture acceptent l'une ou l'autre.
export type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    // Délai côté client, dernier recours. Surtout pas statement_timeout ici : node-postgres l'envoie
    // comme paramètre de démarrage, que PgBouncer refuse (« unsupported startup parameter ») ; la
    // première mise en production, derrière PgBouncer, a échoué ainsi. La pile Proxmox n'en a pas,
    // l'hôte de référence de deploy/ si. Les transactions qui prennent le verrou des
    // synchronisations posent leurs délais serveur elles-mêmes, plus courts (takeSyncLock).
    query_timeout: 15_000,
  });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

type GlobalWithDatabase = typeof globalThis & { __wowAltboardDb?: { pool: Pool; db: Database } };

// Singleton paresseux : aucune connexion n'est ouverte à l'import (le build tourne sans base).
export function getDatabase(): Database {
  const holder = globalThis as GlobalWithDatabase;
  if (!holder.__wowAltboardDb) {
    const pool = createPool(appDatabaseUrl());
    holder.__wowAltboardDb = { pool, db: createDatabase(pool) };
  }
  return holder.__wowAltboardDb.db;
}
