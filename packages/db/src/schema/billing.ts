import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const billingPlan = pgEnum("billing_plan", ["free", "pro", "max", "team"]);
export const billingStatus = pgEnum("billing_status", [
  "active",
  "past_due",
  "cancelled",
  "incomplete",
]);
export const billingProvider = pgEnum("billing_provider", ["stripe", "razorpay"]);
export const billingInterval = pgEnum("billing_interval", ["month", "year"]);

/**
 * A workspace's plan and subscription. No row means the free plan. Written by
 * payment webhooks, which have no user context, so there's no row-level
 * security; the API checks roles itself.
 */
export const billingAccounts = pgTable("billing_accounts", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  plan: billingPlan("plan").notNull().default("free"),
  status: billingStatus("status").notNull().default("active"),
  provider: billingProvider("provider"),
  customerId: text("customer_id"),
  subscriptionId: text("subscription_id").unique(),
  /** Team plan: paid seats. */
  seats: integer("seats").notNull().default(1),
  /** Billed monthly or yearly. */
  interval: billingInterval("interval").notNull().default("month"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** Let usage continue past the plan's limits, billed at cost, up to a monthly cap. */
  extraUsageEnabled: boolean("extra_usage_enabled").notNull().default(false),
  extraUsageCapNanoUsd: bigint("extra_usage_cap_nano_usd", { mode: "number" }).notNull().default(0),
  /**
   * Yearly plans: extra usage is still billed monthly, by Tessel. Usage up to
   * here has been charged.
   */
  extraChargedThrough: timestamp("extra_charged_through", { withTimezone: true }),
  /** For tax invoices: the business's legal name, tax ID (GSTIN in India), and state. */
  taxName: text("tax_name"),
  taxId: text("tax_id"),
  taxState: text("tax_state"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const usageWindowKind = pgEnum("usage_window_kind", ["session", "week"]);

/**
 * Usage limit windows, per person per workspace: a five-hour session and a
 * week, each starting with the first message after the last one ended.
 */
export const usageWindows = pgTable(
  "usage_windows",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: usageWindowKind("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    resetsAt: timestamp("resets_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId, table.kind] })],
);

/**
 * Requests made past a plan limit with extra usage on. Their ledger cost is
 * what gets billed as extra usage.
 */
export const extraUsageRequests = pgTable(
  "extra_usage_requests",
  {
    requestId: text("request_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("extra_usage_requests_workspace_idx").on(table.workspaceId, table.createdAt)],
);

/** Payment webhook events already handled, so a retried delivery is applied once. */
export const billingEvents = pgTable("billing_events", {
  id: text("id").primaryKey(),
  provider: billingProvider("provider").notNull(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingAccountRow = typeof billingAccounts.$inferSelect;
export type BillingPlan = (typeof billingPlan.enumValues)[number];

/**
 * Usage emails already sent, one per threshold per period, so each is sent
 * once: a person nearing their weekly limit, or owners nearing the extra usage cap.
 */
export const usageAlerts = pgTable(
  "usage_alerts",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** "week:<user id>" or "extra". */
    subject: text("subject").notNull(),
    /** When the window or billing period began. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.subject, table.periodStart] })],
);

export type UsageAlertRow = typeof usageAlerts.$inferSelect;
