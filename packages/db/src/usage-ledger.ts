import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "./client";
import { withUserContext } from "./context";
import { usageEvents, type NewUsageEventRow } from "./schema/usage-events";

export type UsageLedgerEvent = Omit<NewUsageEventRow, "id" | "createdAt">;

export interface LedgerSpend {
  user: number;
  workspace: number;
}

/**
 * The Postgres usage ledger. Writes run as the acting user, so row-level
 * security checks that usage is only ever recorded for a workspace the user
 * belongs to.
 */
export function createUsageLedger(db: Database) {
  return {
    async record(event: UsageLedgerEvent): Promise<void> {
      await withUserContext(db, event.userId, (tx) => tx.insert(usageEvents).values(event));
    },

    /** Nano-dollars spent since `since` by the user (everywhere) and in the workspace. */
    spentSince(
      subject: { userId: string; workspaceId: string },
      since: Date,
    ): Promise<LedgerSpend> {
      return withUserContext(db, subject.userId, async (tx) => {
        const [mine] = await tx
          .select({ total: sql<string>`coalesce(sum(${usageEvents.costNanoUsd}), 0)` })
          .from(usageEvents)
          .where(and(eq(usageEvents.userId, subject.userId), gte(usageEvents.createdAt, since)));
        const workspace = await tx.execute<{ total: string | null }>(
          sql`select app.workspace_spend_since(${subject.workspaceId}::uuid, ${since.toISOString()}::timestamptz) as total`,
        );
        return { user: Number(mine?.total ?? 0), workspace: Number(workspace.rows[0]?.total ?? 0) };
      });
    },
  };
}

export type UsageLedgerStore = ReturnType<typeof createUsageLedger>;
