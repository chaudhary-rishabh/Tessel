import { z } from "zod";

export const planIdSchema = z.enum(["free", "pro", "max", "team"]);
export type PlanId = z.infer<typeof planIdSchema>;

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price; per seat for the team plan. */
  price: { usd: number; inr: number };
  /** Price for a year paid at once: two months free. Per seat for the team plan. */
  yearlyPrice: { usd: number; inr: number };
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

/** Costs are kept in billionths of a US dollar. */
export const NANO_USD_PER_USD = 1_000_000_000;
const USD = NANO_USD_PER_USD;

/** Tessel's plans. Limits are measured in model cost, shown to people as a share of their limit. */
export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    description: "Try Tessel on your own documents.",
    price: { usd: 0, inr: 0 },
    yearlyPrice: { usd: 0, inr: 0 },
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
    yearlyPrice: { usd: 200, inr: 19_500 },
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
    yearlyPrice: { usd: 1_000, inr: 97_500 },
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
    yearlyPrice: { usd: 300, inr: 29_000 },
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

export const billingIntervalSchema = z.enum(["month", "year"]);
export type BillingInterval = z.infer<typeof billingIntervalSchema>;

/** India's GST state codes: the first two digits of a GSTIN name the state. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/** A GSTIN: state code, PAN, entity number, Z, and a check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN check character (mod 36 over the first 14 characters). */
export function gstinChecksumValid(gstin: string): boolean {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = chars.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(value / 36) + (value % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === gstin[14];
}

export const taxDetailsSchema = z.object({
  /** The business's legal name, as it should appear on invoices. */
  name: z.string(),
  /** GSTIN, for businesses in India. */
  taxId: z.string().nullable(),
  /** Place of supply: the state the GSTIN is registered in. */
  state: z.string().nullable(),
});

export const updateTaxDetailsRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter the business's legal name").max(200),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => value.replace(/\s+/g, ""))
    .refine((value) => value === "" || GSTIN_PATTERN.test(value), "Enter a 15-character GSTIN")
    .refine(
      (value) =>
        value === "" || (gstinChecksumValid(value) && Boolean(GST_STATES[value.slice(0, 2)])),
      "This GSTIN isn't valid. Check it against your GST certificate.",
    )
    .optional(),
});

export const invoiceSchema = z.object({
  id: z.string(),
  number: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** In the currency's smallest unit (cents or paise). */
  amount: z.number().int(),
  currency: z.string(),
  status: z.string(),
  /** The provider's page for the invoice, with a PDF. */
  url: z.url().nullable(),
});
export const invoiceListResponseSchema = z.object({ invoices: z.array(invoiceSchema) });

export const usageWindowSchema = z.object({
  /** Share of the limit used; 1 or more means the limit is reached. */
  used: z.number(),
  /** When the window ends and the limit resets; null before the first message. */
  resetsAt: z.iso.datetime().nullable(),
});

export const billingSummarySchema = z.object({
  workspaceId: z.uuid(),
  plan: planIdSchema,
  interval: billingIntervalSchema,
  status: z.enum(["active", "past_due", "cancelled", "incomplete"]),
  provider: z.enum(["stripe", "razorpay"]).nullable(),
  seats: z.number(),
  members: z.number(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** Owners and admins manage billing. */
  canManage: z.boolean(),
  extraUsage: z.object({
    available: z.boolean(),
    /** Why it isn't available: a free plan, or a yearly plan paid through Razorpay. */
    unavailableReason: z.enum(["plan", "razorpay_yearly"]).nullable(),
    enabled: z.boolean(),
    capNanoUsd: z.number(),
    spentNanoUsd: z.number(),
  }),
  /** The current person's usage in this workspace. */
  usage: z.object({ session: usageWindowSchema, week: usageWindowSchema }),
  /** Which payment providers this deployment has set up. */
  providers: z.object({ stripe: z.boolean(), razorpay: z.boolean() }),
  /** Which of them have yearly prices. */
  yearly: z.object({ stripe: z.boolean(), razorpay: z.boolean() }),
  /** For tax invoices; only owners and admins see it. */
  tax: taxDetailsSchema.nullable(),
});

export const updateExtraUsageRequestSchema = z.object({
  enabled: z.boolean(),
  /** Monthly cap in US dollars. */
  capUsd: z.number().min(0).max(10_000),
});

export const checkoutRequestSchema = z.object({
  plan: z.enum(["pro", "max", "team"]),
  provider: z.enum(["stripe", "razorpay"]),
  interval: billingIntervalSchema.default("month"),
  /** Team plan: at least the members and the plan's minimum. */
  seats: z.number().int().min(1).max(1000).optional(),
});
/** Where to pay; null when an existing subscription was switched instead. */
export const checkoutResponseSchema = z.object({ url: z.url().nullable() });
export const cancelSubscriptionRequestSchema = z.object({ cancel: z.boolean() });
export const portalResponseSchema = z.object({ url: z.url() });

export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;
export type TaxDetails = z.infer<typeof taxDetailsSchema>;
export type UpdateTaxDetailsRequest = z.input<typeof updateTaxDetailsRequestSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type UsageWindow = z.infer<typeof usageWindowSchema>;
export type BillingSummary = z.infer<typeof billingSummarySchema>;
export type UpdateExtraUsageRequest = z.infer<typeof updateExtraUsageRequestSchema>;
