import { nanoToUsd, type ModelRegistry, type SpendGuard } from "@tessel/ai";
import type { UsageSummary } from "@tessel/contracts";
import { withUserContext, type Database } from "@tessel/db";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { usagePolicy } from "./usage.policy";
import { usageRepository } from "./usage.repository";

const DAY_MS = 86_400_000;
const usd = (nano: number | string) => nanoToUsd(Number(nano));

export function createUsageService({
  db,
  spend,
  registry,
}: {
  db: Database;
  spend: SpendGuard;
  registry: ModelRegistry;
}) {
  // Models removed from the registry since still show up, under their ID.
  const labelFor = (modelId: string) => {
    try {
      return registry.get(modelId).label;
    } catch {
      return modelId;
    }
  };

  return {
    async summary(userId: string, workspaceId: string, days: number): Promise<UsageSummary> {
      const to = new Date();
      const from = new Date(to.getTime() - days * DAY_MS);

      const report = await withUserContext(db, userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(tx, workspaceId, userId);
        if (!workspace) throw errors.notFound("Workspace not found");
        const scope = usagePolicy.canSeeWorkspaceUsage(workspace.role) ? "workspace" : "user";
        const filter = { workspaceId, since: from, ...(scope === "user" ? { userId } : {}) };
        // One connection per transaction, so these run one after another.
        const totals = await usageRepository.totals(tx, filter);
        const byModel = await usageRepository.byModel(tx, filter);
        const byFeature = await usageRepository.byFeature(tx, filter);
        const byDay = await usageRepository.byDay(tx, filter);
        return { scope, totals, byModel, byFeature, byDay } as const;
      });

      const today = await spend.today({ userId, workspaceId });
      const daily = (spent: number, limit: number) => ({
        spentUsd: usd(spent),
        limitUsd: limit > 0 ? usd(limit) : null,
      });
      const amounts = <
        T extends { calls: number; inputTokens: number; outputTokens: number; costNanoUsd: string },
      >(
        row: T,
      ) => ({
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: usd(row.costNanoUsd),
      });

      return {
        scope: report.scope,
        from: from.toISOString(),
        to: to.toISOString(),
        totals: amounts(report.totals),
        byModel: report.byModel.map((row) => ({
          modelId: row.modelId,
          label: labelFor(row.modelId),
          ...amounts(row),
        })),
        byFeature: report.byFeature.map((row) => ({ feature: row.feature, ...amounts(row) })),
        byDay: report.byDay.map((row) => ({
          day: row.day,
          calls: row.calls,
          costUsd: usd(row.costNanoUsd),
        })),
        today: {
          user: daily(today.user, today.limits.user),
          workspace: daily(today.workspace, today.limits.workspace),
          resetsAt: today.resetsAt.toISOString(),
        },
      };
    },
  };
}

export type UsageService = ReturnType<typeof createUsageService>;
