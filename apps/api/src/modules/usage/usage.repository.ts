import { usageEvents, type Transaction } from "@tessel/db";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";

export interface UsageFilter {
  workspaceId: string;
  /** Only this user's usage; omitted for the whole workspace. */
  userId?: string;
  since: Date;
}

const totals = {
  calls: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)::int`,
  costNanoUsd: sql<string>`coalesce(sum(${usageEvents.costNanoUsd}), 0)`,
};

function where(filter: UsageFilter): SQL | undefined {
  return and(
    eq(usageEvents.workspaceId, filter.workspaceId),
    gte(usageEvents.createdAt, filter.since),
    filter.userId ? eq(usageEvents.userId, filter.userId) : undefined,
  );
}

/** Aggregates over the usage ledger. Runs inside withUserContext, so RLS applies too. */
export const usageRepository = {
  async totals(tx: Transaction, filter: UsageFilter) {
    const [row] = await tx.select(totals).from(usageEvents).where(where(filter));
    return row ?? { calls: 0, inputTokens: 0, outputTokens: 0, costNanoUsd: "0" };
  },

  byModel(tx: Transaction, filter: UsageFilter) {
    return tx
      .select({ modelId: usageEvents.modelId, ...totals })
      .from(usageEvents)
      .where(where(filter))
      .groupBy(usageEvents.modelId)
      .orderBy(desc(sql`sum(${usageEvents.costNanoUsd})`));
  },

  byFeature(tx: Transaction, filter: UsageFilter) {
    return tx
      .select({ feature: usageEvents.feature, ...totals })
      .from(usageEvents)
      .where(where(filter))
      .groupBy(usageEvents.feature)
      .orderBy(desc(sql`sum(${usageEvents.costNanoUsd})`));
  },

  byDay(tx: Transaction, filter: UsageFilter) {
    const day = sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    return tx
      .select({ day, calls: totals.calls, costNanoUsd: totals.costNanoUsd })
      .from(usageEvents)
      .where(where(filter))
      .groupBy(day)
      .orderBy(day);
  },
};
