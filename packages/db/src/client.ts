import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDatabaseOptions {
  url: string;
  maxConnections?: number;
}

export function createDatabase({
  url,
  maxConnections = 10,
}: CreateDatabaseOptions): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString: url,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}

/** Cheapest possible round trip, used by readiness checks. */
export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
