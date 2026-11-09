import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "@tessel/contracts";
import type { BillingAccountRow } from "@tessel/db";

/** What a payment webhook means for a workspace's subscription. */
export type SubscriptionUpdate = {
  kind: "subscription";
  workspaceId?: string | undefined;
  subscriptionId: string;
  customerId?: string | undefined;
  plan?: PlanId | undefined;
  status: "active" | "past_due" | "canceled" | "incomplete";
  seats?: number | undefined;
  periodStart?: Date | undefined;
  periodEnd?: Date | undefined;
  cancelAtPeriodEnd?: boolean | undefined;
};

/** A billing period closed: charge any extra usage from it. */
export type PeriodClosed = {
  kind: "period_closed";
  subscriptionId: string;
  /** Stripe's draft invoice for the next period, which extra usage is added to. */
  invoiceId?: string | undefined;
  periodStart: Date;
  periodEnd: Date;
};

export interface WebhookEvent {
  id: string;
  type: string;
  changes: (SubscriptionUpdate | PeriodClosed)[];
}

export interface CheckoutInput {
  workspaceId: string;
  plan: PlanId;
  seats: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
}

export interface PaymentProvider {
  name: "stripe" | "razorpay";
  /** A page where the person pays for a new subscription. */
  checkout(input: CheckoutInput): Promise<{ url: string; subscriptionId?: string }>;
  /** Switches an existing subscription to another plan (prorated). */
  changePlan(account: BillingAccountRow, plan: PlanId, seats: number): Promise<void>;
  updateSeats(account: BillingAccountRow, seats: number): Promise<void>;
  /** Cancels at the end of the period, or undoes that. */
  setCancelAtPeriodEnd(account: BillingAccountRow, cancel: boolean): Promise<void>;
  /** Ends the subscription now, with no further charges (the workspace is being deleted). */
  cancelNow(account: BillingAccountRow): Promise<void>;
  /** The provider's own page for payment methods and invoices, when it has one. */
  portal?(account: BillingAccountRow, returnUrl: string): Promise<string>;
  /** Adds extra usage to the next invoice. */
  chargeExtra(
    account: BillingAccountRow,
    input: { amountNanoUsd: number; description: string; invoiceId?: string | undefined },
  ): Promise<void>;
  /** Verifies the signature and reads the event; null when it isn't genuine. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent | null;
}

export class PaymentProviderError extends Error {}

const TIMEOUT_MS = 15_000;

const sameHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function planFromIds(
  map: Partial<Record<PlanId, string>>,
  id: string | undefined,
): PlanId | undefined {
  return (Object.entries(map) as [PlanId, string][]).find(([, value]) => value === id)?.[0];
}

const seconds = (value: unknown) =>
  typeof value === "number" && value > 0 ? new Date(value * 1000) : undefined;

/* ---------------------------------- Stripe ---------------------------------- */

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Price IDs for each paid plan. */
  prices: Partial<Record<PlanId, string>>;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Flattens nested values into Stripe's form encoding: a[b][0][c]=value. */
function stripeForm(values: Record<string, unknown>, prefix = "", into = new URLSearchParams()) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") stripeForm(value as Record<string, unknown>, name, into);
    else into.append(name, String(value));
  }
  return into;
}

type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  metadata?: Record<string, string>;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data: {
      id: string;
      quantity?: number;
      price?: { id: string };
      current_period_start?: number;
      current_period_end?: number;
    }[];
  };
};

export function createStripeProvider(config: StripeConfig): PaymentProvider {
  const base = (config.baseUrl ?? "https://api.stripe.com").replace(/\/$/, "");
  const fetcher = config.fetch ?? fetch;

  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetcher(`${base}/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body: stripeForm(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new PaymentProviderError(json.error?.message ?? `Stripe answered ${response.status}`);
    }
    return json;
  }

  const priceFor = (plan: PlanId) => {
    const price = config.prices[plan];
    if (!price) throw new PaymentProviderError(`No Stripe price is set for the ${plan} plan`);
    return price;
  };

  const status = (value: string): SubscriptionUpdate["status"] =>
    value === "active" || value === "trialing"
      ? "active"
      : value === "past_due" || value === "unpaid"
        ? "past_due"
        : value === "canceled" || value === "incomplete_expired"
          ? "canceled"
          : "incomplete";

  function toUpdate(subscription: StripeSubscription, deleted = false): SubscriptionUpdate {
    const item = subscription.items?.data[0];
    return {
      kind: "subscription",
      workspaceId: subscription.metadata?.workspaceId,
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      plan:
        (subscription.metadata?.plan as PlanId | undefined) ??
        planFromIds(config.prices, item?.price?.id),
      status: deleted ? "canceled" : status(subscription.status),
      seats: item?.quantity,
      // Newer API versions keep the period on the item.
      periodStart: seconds(subscription.current_period_start ?? item?.current_period_start),
      periodEnd: seconds(subscription.current_period_end ?? item?.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    };
  }

  async function firstItem(subscriptionId: string) {
    const subscription = await call<StripeSubscription>("GET", `/subscriptions/${subscriptionId}`);
    const item = subscription.items?.data[0];
    if (!item) throw new PaymentProviderError("The subscription has no items");
    return item;
  }

  return {
    name: "stripe",

    async checkout(input) {
      const session = await call<{ id: string; url: string }>("POST", "/checkout/sessions", {
        mode: "subscription",
        line_items: { 0: { price: priceFor(input.plan), quantity: input.seats } },
        client_reference_id: input.workspaceId,
        ...(input.customerId ? { customer: input.customerId } : { customer_email: input.email }),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: true,
        metadata: { workspaceId: input.workspaceId, plan: input.plan },
        subscription_data: { metadata: { workspaceId: input.workspaceId, plan: input.plan } },
      });
      return { url: session.url };
    },

    async changePlan(account, plan, seats) {
      const item = await firstItem(account.subscriptionId!);
      await call("POST", `/subscriptions/${account.subscriptionId}`, {
        items: { 0: { id: item.id, price: priceFor(plan), quantity: seats } },
        metadata: { plan, workspaceId: account.workspaceId },
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
      });
    },

    async updateSeats(account, seats) {
      const item = await firstItem(account.subscriptionId!);
      await call("POST", `/subscriptions/${account.subscriptionId}`, {
        items: { 0: { id: item.id, quantity: seats } },
        proration_behavior: "create_prorations",
      });
    },

    async setCancelAtPeriodEnd(account, cancel) {
      await call("POST", `/subscriptions/${account.subscriptionId}`, {
        cancel_at_period_end: cancel,
      });
    },

    async cancelNow(account) {
      await call("DELETE", `/subscriptions/${account.subscriptionId}`);
    },

    async portal(account, returnUrl) {
      const session = await call<{ url: string }>("POST", "/billing_portal/sessions", {
        customer: account.customerId,
        return_url: returnUrl,
      });
      return session.url;
    },

    async chargeExtra(account, { amountNanoUsd, description, invoiceId }) {
      const cents = Math.ceil(amountNanoUsd / 10_000_000);
      if (cents <= 0) return;
      await call("POST", "/invoiceitems", {
        customer: account.customerId,
        amount: cents,
        currency: "usd",
        description,
        ...(invoiceId ? { invoice: invoiceId } : { subscription: account.subscriptionId }),
      });
    },

    parseWebhook(rawBody, headers) {
      const signature = headers["stripe-signature"];
      if (!signature) return null;
      const parts = Object.fromEntries(
        signature.split(",").map((part) => part.split("=") as [string, string]),
      );
      const timestamp = Number(parts.t);
      if (!parts.v1 || !Number.isFinite(timestamp)) return null;
      if (Math.abs(Date.now() / 1000 - timestamp) > 300) return null;
      const expected = createHmac("sha256", config.webhookSecret)
        .update(`${timestamp}.${rawBody.toString("utf8")}`)
        .digest("hex");
      const valid = signature
        .split(",")
        .filter((part) => part.startsWith("v1="))
        .some((part) => sameHex(part.slice(3), expected));
      if (!valid) return null;

      const event = JSON.parse(rawBody.toString("utf8")) as {
        id: string;
        type: string;
        data: { object: Record<string, unknown> };
      };
      const object = event.data.object;
      const changes: WebhookEvent["changes"] = [];
      if (event.type.startsWith("customer.subscription.")) {
        changes.push(
          toUpdate(
            object as unknown as StripeSubscription,
            event.type === "customer.subscription.deleted",
          ),
        );
      } else if (
        event.type === "invoice.created" &&
        object.billing_reason === "subscription_cycle" &&
        typeof object.subscription === "string"
      ) {
        changes.push({
          kind: "period_closed",
          subscriptionId: object.subscription,
          invoiceId: object.id as string,
          periodStart: seconds(object.period_start)!,
          periodEnd: seconds(object.period_end)!,
        });
      }
      return { id: event.id, type: event.type, changes };
    },
  };
}

/* --------------------------------- Razorpay --------------------------------- */

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Plan IDs for each paid plan. */
  plans: Partial<Record<PlanId, string>>;
  /** For charging extra usage, which is measured in US dollars. */
  usdToInr: number;
  baseUrl?: string;
  fetch?: typeof fetch;
}

type RazorpaySubscription = {
  id: string;
  plan_id: string;
  customer_id?: string | null;
  status: string;
  quantity?: number;
  current_start?: number | null;
  current_end?: number | null;
  notes?: Record<string, string> | [];
  short_url?: string;
};

export function createRazorpayProvider(config: RazorpayConfig): PaymentProvider {
  const base = (config.baseUrl ?? "https://api.razorpay.com").replace(/\/$/, "");
  const fetcher = config.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetcher(`${base}/v1${path}`, {
      method,
      headers: { Authorization: auth, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => ({}))) as T & {
      error?: { description?: string };
    };
    if (!response.ok) {
      throw new PaymentProviderError(
        json.error?.description ?? `Razorpay answered ${response.status}`,
      );
    }
    return json;
  }

  const planFor = (plan: PlanId) => {
    const id = config.plans[plan];
    if (!id) throw new PaymentProviderError(`No Razorpay plan is set for the ${plan} plan`);
    return id;
  };

  const status = (value: string): SubscriptionUpdate["status"] =>
    value === "active" || value === "authenticated"
      ? "active"
      : value === "pending" || value === "halted"
        ? "past_due"
        : value === "cancelled" || value === "completed" || value === "expired"
          ? "canceled"
          : "incomplete";

  function toUpdate(subscription: RazorpaySubscription): SubscriptionUpdate {
    const notes = Array.isArray(subscription.notes) ? {} : (subscription.notes ?? {});
    return {
      kind: "subscription",
      workspaceId: notes.workspaceId,
      subscriptionId: subscription.id,
      customerId: subscription.customer_id ?? undefined,
      plan: (notes.plan as PlanId | undefined) ?? planFromIds(config.plans, subscription.plan_id),
      status: status(subscription.status),
      seats: subscription.quantity,
      periodStart: seconds(subscription.current_start),
      periodEnd: seconds(subscription.current_end),
    };
  }

  return {
    name: "razorpay",

    async checkout(input) {
      const subscription = await call<RazorpaySubscription>("POST", "/subscriptions", {
        plan_id: planFor(input.plan),
        // Monthly for up to ten years; cancelled from Tessel.
        total_count: 120,
        quantity: input.seats,
        customer_notify: 1,
        notes: { workspaceId: input.workspaceId, plan: input.plan, email: input.email },
      });
      if (!subscription.short_url) throw new PaymentProviderError("Razorpay sent no payment link");
      return { url: subscription.short_url, subscriptionId: subscription.id };
    },

    async changePlan(account, plan, seats) {
      await call("PATCH", `/subscriptions/${account.subscriptionId}`, {
        plan_id: planFor(plan),
        quantity: seats,
        schedule_change_at: "now",
        customer_notify: 1,
      });
    },

    async updateSeats(account, seats) {
      await call("PATCH", `/subscriptions/${account.subscriptionId}`, {
        quantity: seats,
        schedule_change_at: "now",
      });
    },

    async setCancelAtPeriodEnd(account, cancel) {
      if (!cancel) {
        throw new PaymentProviderError(
          "Razorpay can't undo a cancellation. Subscribe again after it ends.",
        );
      }
      await call("POST", `/subscriptions/${account.subscriptionId}/cancel`, {
        cancel_at_cycle_end: 1,
      });
    },

    async cancelNow(account) {
      await call("POST", `/subscriptions/${account.subscriptionId}/cancel`, {
        cancel_at_cycle_end: 0,
      });
    },

    async chargeExtra(account, { amountNanoUsd, description }) {
      const paise = Math.ceil((amountNanoUsd / 1e9) * config.usdToInr * 100);
      if (paise <= 0) return;
      await call("POST", `/subscriptions/${account.subscriptionId}/addons`, {
        item: { name: "Extra usage", amount: paise, currency: "INR", description },
        quantity: 1,
      });
    },

    parseWebhook(rawBody, headers) {
      const signature = headers["x-razorpay-signature"];
      if (!signature) return null;
      const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
      if (!sameHex(signature, expected)) return null;
      const event = JSON.parse(rawBody.toString("utf8")) as {
        event: string;
        created_at?: number;
        payload: { subscription?: { entity: RazorpaySubscription } };
      };
      const subscription = event.payload.subscription?.entity;
      const changes: WebhookEvent["changes"] = [];
      if (subscription && event.event.startsWith("subscription.")) {
        changes.push(toUpdate(subscription));
      }
      return {
        id:
          headers["x-razorpay-event-id"] ??
          `${event.event}:${subscription?.id}:${event.created_at}`,
        type: event.event,
        changes,
      };
    },
  };
}
