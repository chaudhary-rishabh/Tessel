import { PLANS, type Plan, type PlanId, type UsageWindow } from "@tessel/contracts";
import {
  billingAccounts,
  extraUsageRequests,
  usageEvents,
  usageWindows,
  withUserContext,
  type BillingAccountRow,
  type Database,
} from "@tessel/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { AppError, errors } from "../../lib/errors";

const HOUR_MS = 3_600_000;
const WINDOWS = {
  session: { durationMs: 5 * HOUR_MS, limit: (plan: Plan) => plan.limits.sessionNanoUsd },
  week: { durationMs: 7 * 24 * HOUR_MS, limit: (plan: Plan) => plan.limits.weekNanoUsd },
} as const;
type WindowKind = keyof typeof WINDOWS;

export interface UsageActor {
  workspaceId: string;
  userId: string;
  /** Requests past a limit with extra usage on are recorded by this ID. */
  requestId?: string | undefined;
}

/**
 * The tier of the model a request will use. An unknown model counts as free:
 * the model call itself refuses it with a clearer error.
 */
export function modelTier(
  registry: { resolve(id: string | undefined, role: "chat"): { tier: "free" | "pro" } },
  id: string | undefined,
): "free" | "pro" {
  try {
    return registry.resolve(id, "chat").tier;
  } catch {
    return "free";
  }
}

/** How long a failed payment keeps the paid plan after the period it was for ends. */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The plan in force. A cancelled or never-paid subscription counts as free,
 * and a past-due one keeps its plan for a short grace period after its
 * billing period ends, so a fixed card doesn't interrupt anyone but an
 * unpaid plan doesn't last for ever.
 */
export function effectivePlan(account: BillingAccountRow | undefined, now = new Date()): Plan {
  if (!account || account.status === "cancelled" || account.status === "incomplete") {
    return PLANS.free;
  }
  if (account.status === "past_due") {
    const end = account.currentPeriodEnd?.getTime();
    if (end === undefined || now.getTime() > end + PAST_DUE_GRACE_MS) return PLANS.free;
  }
  return PLANS[account.plan as PlanId];
}

/** The same day and time `months` later, on the month's last day when it's shorter. */
export function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target;
}

/**
 * Where the current month of extra usage started, for its cap. That's the
 * billing period on monthly plans; yearly plans count each month from the
 * day the year began.
 */
export function periodStart(account: BillingAccountRow | undefined, now: Date): Date {
  if (account?.currentPeriodStart && account.currentPeriodStart <= now) {
    if (account.interval !== "year") return account.currentPeriodStart;
    let months = 0;
    while (months < 12 && addMonths(account.currentPeriodStart, months + 1) <= now) months++;
    return addMonths(account.currentPeriodStart, months);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Whether extra usage can be on. Razorpay bills add-ons only with the
 * subscription's next charge, a year away on yearly plans, so it isn't offered there.
 */
export function extraUsageUnavailable(
  plan: Plan,
  account: BillingAccountRow | undefined,
): "plan" | "razorpay_yearly" | null {
  if (!plan.extraUsage) return "plan";
  if (account?.provider === "razorpay" && account.interval === "year") return "razorpay_yearly";
  return null;
}

/** Usage worth an email: a person near their weekly limit, or a workspace near its extra usage cap. */
export type UsageAlert =
  | {
      kind: "week";
      workspaceId: string;
      userId: string;
      periodStart: Date;
      resetsAt: Date;
      share: number;
    }
  | {
      kind: "extra";
      workspaceId: string;
      userId: string;
      periodStart: Date;
      spentNanoUsd: number;
      capNanoUsd: number;
    };

/** The share of a limit that sends the email. */
export const ALERT_SHARE = 0.8;

const resetLabel = (date: Date) =>
  date.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

/**
 * Plan limits for chat: a five-hour session and a weekly limit per person per
 * workspace, measured in model cost, plus which models the plan may use.
 * Past a limit, extra usage (when the workspace turned it on) lets requests
 * continue up to a monthly cap; otherwise they're refused until the window resets.
 */
export function createUsageLimits({
  db,
  now = () => new Date(),
  onAlert,
}: {
  db: Database;
  now?: () => Date;
  /** Called, without waiting, when usage crosses ALERT_SHARE of a limit. */
  onAlert?: (alert: UsageAlert) => void;
}) {
  async function account(workspaceId: string) {
    const [row] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.workspaceId, workspaceId));
    return row;
  }

  /** Each window's state for a person, without starting any. */
  async function windows(actor: UsageActor, plan: Plan) {
    return withUserContext(db, actor.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(usageWindows)
        .where(
          and(
            eq(usageWindows.workspaceId, actor.workspaceId),
            eq(usageWindows.userId, actor.userId),
          ),
        );
      const at = now();
      const result = {} as Record<
        WindowKind,
        { used: number; limit: number; resetsAt: Date | null; startedAt: Date | null }
      >;
      for (const kind of Object.keys(WINDOWS) as WindowKind[]) {
        const limit = WINDOWS[kind].limit(plan);
        const row = rows.find((item) => item.kind === kind);
        if (!row || row.resetsAt <= at) {
          result[kind] = { used: 0, limit, resetsAt: null, startedAt: null };
          continue;
        }
        // Each person reads their own ledger rows under row-level security.
        const [sum] = await tx
          .select({ cost: sql<string>`coalesce(sum(${usageEvents.costNanoUsd}), 0)` })
          .from(usageEvents)
          .where(
            and(
              eq(usageEvents.workspaceId, actor.workspaceId),
              eq(usageEvents.userId, actor.userId),
              gte(usageEvents.createdAt, row.startedAt),
            ),
          );
        result[kind] = {
          used: Number(sum?.cost ?? 0),
          limit,
          resetsAt: row.resetsAt,
          startedAt: row.startedAt,
        };
      }
      return result;
    });
  }

  /** Starts any window that isn't running, from now. */
  async function startWindows(actor: UsageActor) {
    const at = now();
    for (const [kind, { durationMs }] of Object.entries(WINDOWS) as [
      WindowKind,
      { durationMs: number },
    ][]) {
      const resetsAt = new Date(at.getTime() + durationMs);
      await db
        .insert(usageWindows)
        .values({
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          kind,
          startedAt: at,
          resetsAt,
        })
        .onConflictDoUpdate({
          target: [usageWindows.workspaceId, usageWindows.userId, usageWindows.kind],
          set: { startedAt: at, resetsAt },
          setWhere: sql`${usageWindows.resetsAt} <= ${at.toISOString()}::timestamptz`,
        });
    }
  }

  async function extraSpent(workspaceId: string, since: Date): Promise<number> {
    const result = await db.execute<{ cost: string }>(
      sql`SELECT app.workspace_extra_cost(${workspaceId}, ${since.toISOString()}::timestamptz) AS cost`,
    );
    return Number(result.rows[0]?.cost ?? 0);
  }

  return {
    account,
    effectivePlan: (current: BillingAccountRow | undefined) => effectivePlan(current, now()),
    extraSpent,

    /** The person's usage in a workspace, as shares of each limit. */
    async status(actor: UsageActor): Promise<{ session: UsageWindow; week: UsageWindow }> {
      const plan = effectivePlan(await account(actor.workspaceId), now());
      const state = await windows(actor, plan);
      const view = (kind: WindowKind): UsageWindow => ({
        used: state[kind].limit > 0 ? state[kind].used / state[kind].limit : 0,
        resetsAt: state[kind].resetsAt?.toISOString() ?? null,
      });
      return { session: view("session"), week: view("week") };
    },

    /**
     * Allows a chat request or refuses it. Returns "extra" when it goes ahead
     * as extra usage.
     */
    async check(actor: UsageActor, modelTier: "free" | "pro"): Promise<"included" | "extra"> {
      const current = await account(actor.workspaceId);
      const plan = effectivePlan(current, now());
      if (modelTier === "pro" && plan.modelTier === "free") {
        throw errors.forbidden(
          "This model needs a paid plan. Pick another model, or upgrade in Settings.",
          "model_requires_plan",
        );
      }
      const state = await windows(actor, plan);
      const week = state.week;
      if (onAlert && week.startedAt && week.resetsAt && week.used >= ALERT_SHARE * week.limit) {
        onAlert({
          kind: "week",
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          periodStart: week.startedAt,
          resetsAt: week.resetsAt,
          share: week.used / week.limit,
        });
      }
      const over = (Object.keys(WINDOWS) as WindowKind[]).filter(
        (kind) => state[kind].used >= state[kind].limit,
      );
      if (over.length === 0) {
        await startWindows(actor);
        return "included";
      }
      if (!extraUsageUnavailable(plan, current) && current?.extraUsageEnabled) {
        const since = periodStart(current, now());
        const spent = await extraSpent(actor.workspaceId, since);
        if (onAlert && current.extraUsageCapNanoUsd > 0) {
          if (spent >= ALERT_SHARE * current.extraUsageCapNanoUsd) {
            onAlert({
              kind: "extra",
              workspaceId: actor.workspaceId,
              userId: actor.userId,
              periodStart: since,
              spentNanoUsd: spent,
              capNanoUsd: current.extraUsageCapNanoUsd,
            });
          }
        }
        if (spent < current.extraUsageCapNanoUsd) {
          if (actor.requestId) {
            await db
              .insert(extraUsageRequests)
              .values({
                requestId: actor.requestId,
                workspaceId: actor.workspaceId,
                userId: actor.userId,
              })
              .onConflictDoNothing();
          }
          return "extra";
        }
      }
      const resetsAt = over
        .map((kind) => state[kind].resetsAt!)
        .sort((a, b) => b.getTime() - a.getTime())[0]!;
      const which = over.includes("week") ? "weekly" : "five-hour";
      throw new AppError(
        429,
        "usage_limit_reached",
        `You've reached your ${which} usage limit. It resets ${resetLabel(resetsAt)}.${plan.extraUsage ? " Turn on extra usage in Settings to keep going." : " Upgrade for higher limits."}`,
        { resetsAt: resetsAt.toISOString(), window: over.includes("week") ? "week" : "session" },
      );
    },
  };
}

export type UsageLimits = ReturnType<typeof createUsageLimits>;
