import {
  PLANS,
  type BillingSummary,
  type PlanId,
  type UpdateExtraUsageRequest,
} from "@tessel/contracts";
import {
  billingAccounts,
  billingEvents,
  users,
  withUserContext,
  workspaceMembers,
  type BillingAccountRow,
  type Database,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { count, eq, sql } from "drizzle-orm";
import type { AuditRecorder } from "../../lib/audit";
import { errors } from "../../lib/errors";
import {
  PaymentProviderError,
  type PaymentProvider,
  type PeriodClosed,
  type SubscriptionUpdate,
} from "./providers";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { periodStart, type UsageLimits } from "./usage-limits";

const USD = 1_000_000_000;

export interface BillingActor {
  userId: string;
  workspaceId: string;
  ipAddress?: string | undefined;
}

/** A workspace's plan, limits, and extra usage, as Settings shows them. */
export function createBillingService({
  db,
  limits,
  audit,
  logger,
  payments = {},
  webOrigin,
  now = () => new Date(),
}: {
  db: Database;
  limits: UsageLimits;
  audit: AuditRecorder;
  logger: Logger;
  /** Payment providers this deployment has set up. */
  payments?: Partial<Record<"stripe" | "razorpay", PaymentProvider>>;
  /** For return links from payment pages. */
  webOrigin: string;
  now?: () => Date;
}) {
  const providers = { stripe: Boolean(payments.stripe), razorpay: Boolean(payments.razorpay) };

  function requireManager(role: string) {
    if (role !== "owner" && role !== "admin") {
      throw errors.forbidden("Only owners and admins can change billing");
    }
  }

  function provider(name: "stripe" | "razorpay" | null | undefined): PaymentProvider {
    const found = name ? payments[name] : undefined;
    if (!found) throw errors.badRequest("payments_unavailable", "That payment method isn't set up");
    return found;
  }

  /** Payment provider failures, shown plainly instead of as server errors. */
  async function viaProvider<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        logger.warn({ err: error }, "Payment provider refused a request");
        throw errors.badRequest("payment_provider_error", error.message);
      }
      throw error;
    }
  }

  const hasSubscription = (account: BillingAccountRow | undefined) =>
    Boolean(account?.subscriptionId && account.provider && account.status !== "canceled");

  async function extraBetween(workspaceId: string, since: Date, until: Date) {
    const result = await db.execute<{ cost: string }>(
      sql`SELECT app.workspace_extra_cost_between(${workspaceId}, ${since.toISOString()}::timestamptz, ${until.toISOString()}::timestamptz) AS cost`,
    );
    return Number(result.rows[0]?.cost ?? 0);
  }

  async function chargePeriod(
    account: BillingAccountRow,
    closed: Omit<PeriodClosed, "kind" | "subscriptionId">,
  ) {
    const amount = await extraBetween(account.workspaceId, closed.periodStart, closed.periodEnd);
    if (amount <= 0 || !account.provider) return;
    await provider(account.provider).chargeExtra(account, {
      amountNanoUsd: amount,
      description: `Tessel extra usage, ${closed.periodStart.toISOString().slice(0, 10)} to ${closed.periodEnd.toISOString().slice(0, 10)}`,
      invoiceId: closed.invoiceId,
    });
    await audit.record({
      workspaceId: account.workspaceId,
      action: "billing.extra_usage_charged",
      metadata: { amountNanoUsd: amount, provider: account.provider },
    });
  }

  async function findAccount(update: { subscriptionId: string; workspaceId?: string | undefined }) {
    const [bySubscription] = await db
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.subscriptionId, update.subscriptionId));
    if (bySubscription) return bySubscription;
    if (!update.workspaceId) return undefined;
    return limits.account(update.workspaceId);
  }

  const isForeignKeyViolation = (error: unknown) => {
    const cause = (error as { cause?: { code?: string }; code?: string } | null) ?? {};
    return cause.code === "23503" || cause.cause?.code === "23503";
  };

  async function applySubscription(name: "stripe" | "razorpay", update: SubscriptionUpdate) {
    const existing = await findAccount(update);
    const workspaceId = existing?.workspaceId ?? update.workspaceId;
    if (!workspaceId) {
      logger.warn({ subscriptionId: update.subscriptionId }, "Webhook for an unknown subscription");
      return;
    }
    // Razorpay has no invoice event: a new period means the last one closed.
    if (
      name === "razorpay" &&
      existing?.currentPeriodStart &&
      update.periodStart &&
      update.periodStart > existing.currentPeriodStart
    ) {
      await chargePeriod(existing, {
        periodStart: existing.currentPeriodStart,
        periodEnd: update.periodStart,
      });
    }
    const values = {
      provider: name,
      subscriptionId: update.subscriptionId,
      status: update.status,
      ...(update.plan ? { plan: update.plan } : {}),
      ...(update.customerId ? { customerId: update.customerId } : {}),
      ...(update.seats ? { seats: update.seats } : {}),
      ...(update.periodStart ? { currentPeriodStart: update.periodStart } : {}),
      ...(update.periodEnd ? { currentPeriodEnd: update.periodEnd } : {}),
      ...(update.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: update.cancelAtPeriodEnd }
        : {}),
    };
    try {
      await db
        .insert(billingAccounts)
        .values({ workspaceId, ...values })
        .onConflictDoUpdate({ target: billingAccounts.workspaceId, set: values });
    } catch (error) {
      // A late event for a workspace that has since been deleted: nothing to update.
      if (isForeignKeyViolation(error)) {
        logger.info({ workspaceId }, "Webhook for a deleted workspace");
        return;
      }
      throw error;
    }
    if (existing?.plan !== update.plan || existing?.status !== update.status) {
      await audit.record({
        workspaceId,
        action: "billing.subscription_changed",
        metadata: {
          plan: update.plan ?? existing?.plan ?? null,
          status: update.status,
          provider: name,
        },
      });
    }
  }
  async function membership(actor: BillingActor) {
    return withUserContext(db, actor.userId, async (tx) => {
      const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
      if (!workspace) throw errors.notFound("Workspace not found");
      const [members] = await tx
        .select({ total: count() })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, actor.workspaceId));
      return { workspace, members: members?.total ?? 1 };
    });
  }

  return {
    async summary(actor: BillingActor): Promise<BillingSummary> {
      const { workspace, members } = await membership(actor);
      const account = await limits.account(actor.workspaceId);
      const plan = limits.effectivePlan(account);
      const canManage = workspace.role === "owner" || workspace.role === "admin";
      return {
        workspaceId: actor.workspaceId,
        plan: plan.id,
        status: account?.status ?? "active",
        provider: account?.provider ?? null,
        seats: account?.seats ?? 1,
        members,
        currentPeriodEnd: account?.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
        canManage,
        extraUsage: {
          available: plan.extraUsage,
          enabled: Boolean(plan.extraUsage && account?.extraUsageEnabled),
          capNanoUsd: account?.extraUsageCapNanoUsd ?? 0,
          spentNanoUsd: canManage
            ? await limits.extraSpent(actor.workspaceId, periodStart(account, now()))
            : 0,
        },
        usage: await limits.status(actor),
        providers,
      };
    },

    /** Owners and admins turn extra usage on or off and set its monthly cap. */
    async updateExtraUsage(
      actor: BillingActor,
      input: UpdateExtraUsageRequest,
    ): Promise<BillingSummary> {
      const { workspace } = await membership(actor);
      if (workspace.role !== "owner" && workspace.role !== "admin") {
        throw errors.forbidden("Only owners and admins can change billing");
      }
      const account = await limits.account(actor.workspaceId);
      if (input.enabled && !limits.effectivePlan(account).extraUsage) {
        throw errors.conflict(
          "plan_has_no_extra_usage",
          "Extra usage comes with paid plans. Upgrade first.",
        );
      }
      const cap = Math.round(input.capUsd * USD);
      await db
        .insert(billingAccounts)
        .values({
          workspaceId: actor.workspaceId,
          extraUsageEnabled: input.enabled,
          extraUsageCapNanoUsd: cap,
        })
        .onConflictDoUpdate({
          target: billingAccounts.workspaceId,
          set: { extraUsageEnabled: input.enabled, extraUsageCapNanoUsd: cap },
        });
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "billing.extra_usage_changed",
        metadata: { enabled: input.enabled, capUsd: input.capUsd },
        ipAddress: actor.ipAddress,
      });
      return this.summary(actor);
    },

    /**
     * Starts paying for a plan: a payment page for a new subscription, or a
     * prorated switch when the workspace already has one.
     */
    async checkout(
      actor: BillingActor,
      input: {
        plan: Exclude<PlanId, "free">;
        provider: "stripe" | "razorpay";
        seats?: number | undefined;
      },
    ): Promise<{ url: string | null }> {
      const { workspace, members } = await membership(actor);
      requireManager(workspace.role);
      const plan = PLANS[input.plan];
      if (plan.teamOnly !== !workspace.isPersonal) {
        throw errors.badRequest(
          "plan_not_for_workspace",
          plan.teamOnly
            ? "The Team plan is for team workspaces. Create one to subscribe."
            : "Pro and Max are for your personal workspace. Team workspaces use the Team plan.",
        );
      }
      const seats = plan.perSeat ? Math.max(plan.minSeats, members, input.seats ?? 0) : 1;
      const account = await limits.account(actor.workspaceId);
      if (hasSubscription(account)) {
        await viaProvider(() =>
          provider(account!.provider).changePlan(account!, input.plan, seats),
        );
        await audit.record({
          actorId: actor.userId,
          workspaceId: actor.workspaceId,
          action: "billing.plan_change_requested",
          metadata: { plan: input.plan, seats },
          ipAddress: actor.ipAddress,
        });
        return { url: null };
      }
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, actor.userId));
      const settings = `${webOrigin}/settings`;
      const started = await viaProvider(() =>
        provider(input.provider).checkout({
          workspaceId: actor.workspaceId,
          plan: input.plan,
          seats,
          email: owner!.email,
          successUrl: `${settings}?billing=success#plan`,
          cancelUrl: `${settings}?billing=cancelled#plan`,
          customerId: account?.provider === input.provider ? account.customerId : null,
        }),
      );
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "billing.checkout_started",
        metadata: { plan: input.plan, provider: input.provider, seats },
        ipAddress: actor.ipAddress,
      });
      return { url: started.url };
    },

    /** The provider's page for cards and invoices (Stripe). */
    async portal(actor: BillingActor): Promise<{ url: string }> {
      const { workspace } = await membership(actor);
      requireManager(workspace.role);
      const account = await limits.account(actor.workspaceId);
      const found = account?.provider ? payments[account.provider] : undefined;
      if (!account?.customerId || !found?.portal) {
        throw errors.badRequest("no_billing_portal", "There's no payment account to manage");
      }
      return { url: await viaProvider(() => found.portal!(account, `${webOrigin}/settings#plan`)) };
    },

    /** Cancels at the end of the period, or keeps the plan after all. */
    /**
     * Ends a workspace's subscription at once, before the workspace is deleted.
     * Throws when the provider refuses, so a deleted workspace is never billed again.
     */
    async endForDeletion(workspaceId: string): Promise<void> {
      const account = await limits.account(workspaceId);
      if (!hasSubscription(account)) return;
      await viaProvider(() => provider(account!.provider).cancelNow(account!));
    },

    async setCancel(actor: BillingActor, cancel: boolean): Promise<BillingSummary> {
      const { workspace } = await membership(actor);
      requireManager(workspace.role);
      const account = await limits.account(actor.workspaceId);
      if (!hasSubscription(account))
        throw errors.badRequest("no_subscription", "This workspace has no subscription");
      await viaProvider(() => provider(account!.provider).setCancelAtPeriodEnd(account!, cancel));
      await db
        .update(billingAccounts)
        .set({ cancelAtPeriodEnd: cancel })
        .where(eq(billingAccounts.workspaceId, actor.workspaceId));
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: cancel ? "billing.cancel_scheduled" : "billing.cancel_undone",
        ipAddress: actor.ipAddress,
      });
      return this.summary(actor);
    },

    /** Applies a payment webhook once. Returns false when the signature doesn't check out. */
    async handleWebhook(
      name: "stripe" | "razorpay",
      rawBody: Buffer,
      headers: Record<string, string | undefined>,
    ): Promise<boolean> {
      const found = payments[name];
      if (!found) return false;
      const event = found.parseWebhook(rawBody, headers);
      if (!event) return false;
      const fresh = await db
        .insert(billingEvents)
        .values({ id: `${name}:${event.id}`, provider: name, type: event.type })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (fresh.length === 0) return true;
      for (const change of event.changes) {
        if (change.kind === "subscription") {
          await applySubscription(name, change);
        } else {
          const account = await findAccount(change);
          if (account) await chargePeriod(account, change);
        }
      }
      return true;
    },

    /** Team plans pay for every member: called when people join or leave. */
    async syncSeats(workspaceId: string): Promise<void> {
      const account = await limits.account(workspaceId);
      if (!account || account.plan !== "team" || !hasSubscription(account)) return;
      // Members are behind row-level security and this runs without a user, so ask the database.
      const result = await db.execute<{ total: string }>(
        sql`SELECT app.workspace_member_count(${workspaceId})::text AS total`,
      );
      const members = result.rows[0];
      const seats = Math.max(PLANS.team.minSeats, Number(members?.total ?? 1));
      if (seats === account.seats) return;
      try {
        await provider(account.provider).updateSeats(account, seats);
        await db
          .update(billingAccounts)
          .set({ seats })
          .where(eq(billingAccounts.workspaceId, workspaceId));
        await audit.record({
          workspaceId,
          action: "billing.seats_changed",
          metadata: { from: account.seats, to: seats },
        });
      } catch (error) {
        logger.error({ err: error, workspaceId }, "Couldn't update the Team plan's seats");
      }
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
