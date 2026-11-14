import { NANO_USD_PER_USD } from "@tessel/contracts";
import {
  billingAccounts,
  usageAlerts,
  users,
  withUserContext,
  workspaceMembers,
  workspaces,
  type Database,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { and, eq, inArray } from "drizzle-orm";
import { emails, type Mailer } from "../../lib/mailer";
import { effectivePlan, type UsageAlert } from "./usage-limits";

const dollars = (nano: number) => `$${(nano / NANO_USD_PER_USD).toFixed(2)}`;

const resetLabel = (date: Date) =>
  date.toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

/**
 * Emails people as usage nears a limit, once per window: the person at 80%
 * of their weekly limit, and the workspace's owners and admins at 80% of
 * the extra usage cap.
 */
export function createUsageAlerts({
  db,
  mailer,
  logger,
  webOrigin,
}: {
  db: Database;
  mailer: Mailer;
  logger: Logger;
  webOrigin: string;
}) {
  // Already handled in this process; the table makes it once across all of them.
  const seen = new Set<string>();

  async function claim(workspaceId: string, subject: string, periodStart: Date) {
    const inserted = await db
      .insert(usageAlerts)
      .values({ workspaceId, subject, periodStart })
      .onConflictDoNothing()
      .returning({ subject: usageAlerts.subject });
    return inserted.length > 0;
  }

  async function send(alert: UsageAlert) {
    const subject = alert.kind === "week" ? `week:${alert.userId}` : "extra";
    const key = `${alert.workspaceId}:${subject}:${alert.periodStart.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 10_000) seen.clear();
    if (!(await claim(alert.workspaceId, subject, alert.periodStart))) return;

    const link = `${webOrigin}/settings#plan`;
    // As the person who hit it: they're a member, so they can see the workspace and its admins.
    const { workspace, recipients } = await withUserContext(db, alert.userId, async (tx) => {
      const [found] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, alert.workspaceId));
      const people =
        alert.kind === "week"
          ? await tx.select({ email: users.email }).from(users).where(eq(users.id, alert.userId))
          : await tx
              .select({ email: users.email })
              .from(workspaceMembers)
              .innerJoin(users, eq(users.id, workspaceMembers.userId))
              .where(
                and(
                  eq(workspaceMembers.workspaceId, alert.workspaceId),
                  inArray(workspaceMembers.role, ["owner", "admin"]),
                ),
              );
      return { workspace: found?.name ?? "your workspace", recipients: people };
    });

    if (alert.kind === "week") {
      const [account] = await db
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.workspaceId, alert.workspaceId));
      const canExtra = effectivePlan(account).extraUsage;
      for (const { email } of recipients) {
        await mailer.send(
          emails.weeklyLimitNear(email, {
            workspace,
            percent: Math.min(99, Math.floor(alert.share * 100)),
            resets: resetLabel(alert.resetsAt),
            link,
            canExtra,
          }),
        );
      }
    } else {
      for (const { email } of recipients) {
        await mailer.send(
          emails.extraUsageCapNear(email, {
            workspace,
            spent: dollars(alert.spentNanoUsd),
            cap: dollars(alert.capNanoUsd),
            link,
          }),
        );
      }
    }
    logger.info({ workspaceId: alert.workspaceId, kind: alert.kind }, "Sent a usage alert");
  }

  return {
    /** Fire and forget: a failed email never holds up or fails a request. */
    notify(alert: UsageAlert) {
      void send(alert).catch((error: unknown) =>
        logger.error({ err: error, workspaceId: alert.workspaceId }, "Couldn't send a usage alert"),
      );
    },
    /** For tests: waits for the alerts in flight. */
    send,
  };
}

export type UsageAlerts = ReturnType<typeof createUsageAlerts>;
