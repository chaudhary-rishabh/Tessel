import { sql } from "drizzle-orm";
import type { Database } from "./client";

/** A Drizzle transaction handle. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run queries: the pool-backed database or a transaction. */
export type Executor = Database | Transaction;

/**
 * Runs `work` in a transaction that acts for `userId`. Row-level security
 * policies read this setting, so tenant tables only return rows the user is
 * allowed to see. The setting is transaction-local and never leaks to other
 * requests that reuse the same pooled connection.
 */
export function withUserContext<T>(
  db: Database,
  userId: string,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setUserContext(tx, userId);
    return work(tx);
  });
}

/** Sets the acting user for the rest of an open transaction. */
export async function setUserContext(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
}
