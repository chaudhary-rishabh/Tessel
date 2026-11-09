import { z } from "zod";

export const planIdSchema = z.enum(["free", "pro", "max", "team"]);
export type PlanId = z.infer<typeof planIdSchema>;

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price; per seat for the team plan. */
  price: { usd: number; inr: number };
  perSeat: boolean;
  /** Team plans are for team workspaces; the others for personal ones. */
  teamOnly: boolean;
  minSeats: number;
  /** Highest model tier the plan can use. */
  modelTier: "free" | "pro";
  /** Usage limits per person, in billionths of a dollar of model cost. */
  limits: { sessionNanoUsd: number; weekNanoUsd: number };
  /** Whether extra usage past the limits can be turned on. */
  extraUsage: boolean;
  features: string[];
}

const USD = 1_000_000_000;

/** Tessel's plans. Limits are measured in model cost, shown to people as a share of their limit. */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    description: "Try Tessel on your own documents.",
    price: { usd: 0, inr: 0 },
    perSeat: false,
    teamOnly: false,
    minSeats: 1,
    modelTier: "free",
    limits: { sessionNanoUsd: 0.4 * USD, weekNanoUsd: 2 * USD },
    extraUsage: false,
    features: ["Everyday models", "Documents, skills, and connectors", "Memory across chats"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "For people who use Tessel every day.",
    price: { usd: 20, inr: 1_950 },
    perSeat: false,
    teamOnly: false,
    minSeats: 1,
    modelTier: "pro",
    limits: { sessionNanoUsd: 4 * USD, weekNanoUsd: 20 * USD },
    extraUsage: true,
    features: [
      "10 times the Free limits",
      "Every model, including the most capable",
      "Extra usage when you need it",
    ],
  },
  max: {
    id: "max",
    name: "Max",
    description: "For heavy, all-day work.",
    price: { usd: 100, inr: 9_750 },
    perSeat: false,
    teamOnly: false,
    minSeats: 1,
    modelTier: "pro",
    limits: { sessionNanoUsd: 20 * USD, weekNanoUsd: 100 * USD },
    extraUsage: true,
    features: ["5 times the Pro limits", "Every model", "Extra usage when you need it"],
  },
  team: {
    id: "team",
    name: "Team",
    description: "For teams sharing documents, skills, and connectors.",
    price: { usd: 30, inr: 2_900 },
    perSeat: true,
    teamOnly: true,
    minSeats: 2,
    modelTier: "pro",
    limits: { sessionNanoUsd: 5 * USD, weekNanoUsd: 25 * USD },
    extraUsage: true,
    features: [
      "More than Pro, for each person",
      "Every model",
      "Shared workspace, admin controls, and audit log",
    ],
  },
};

export const usageWindowSchema = z.object({
  /** Share of the limit used; 1 or more means the limit is reached. */
  used: z.number(),
  /** When the window ends and the limit resets; null before the first message. */
  resetsAt: z.iso.datetime().nullable(),
});

export const billingSummarySchema = z.object({
  workspaceId: z.uuid(),
  plan: planIdSchema,
  status: z.enum(["active", "past_due", "canceled", "incomplete"]),
  provider: z.enum(["stripe", "razorpay"]).nullable(),
  seats: z.number(),
  members: z.number(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Owners and admins manage billing. */
  canManage: z.boolean(),
  extraUsage: z.object({
    available: z.boolean(),
    enabled: z.boolean(),
    capNanoUsd: z.number(),
    spentNanoUsd: z.number(),
  }),
  /** The current person's usage in this workspace. */
  usage: z.object({ session: usageWindowSchema, week: usageWindowSchema }),
  /** Which payment providers this deployment has set up. */
  providers: z.object({ stripe: z.boolean(), razorpay: z.boolean() }),
});

export const updateExtraUsageRequestSchema = z.object({
  enabled: z.boolean(),
  /** Monthly cap in US dollars. */
  capUsd: z.number().min(0).max(10_000),
});

export const checkoutRequestSchema = z.object({
  plan: z.enum(["pro", "max", "team"]),
  provider: z.enum(["stripe", "razorpay"]),
  /** Team plan: at least the members and the plan's minimum. */
  seats: z.number().int().min(1).max(1000).optional(),
});
/** Where to pay; null when an existing subscription was switched instead. */
export const checkoutResponseSchema = z.object({ url: z.url().nullable() });
export const cancelSubscriptionRequestSchema = z.object({ cancel: z.boolean() });
export const portalResponseSchema = z.object({ url: z.url() });

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type BillingSummary = z.infer<typeof billingSummarySchema>;
export type UpdateExtraUsageRequest = z.infer<typeof updateExtraUsageRequestSchema>;
