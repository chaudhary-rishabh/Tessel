import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingInterval, Invoice, PlanId, TaxDetails } from "@tessel/contracts";
import type { BillingAccountRow } from "@tessel/db";

/** What a payment webhook means for a workspace's subscription. */
export type SubscriptionUpdate = {
  kind: "subscription";
  workspaceId?: string | undefined;
  subscriptionId: string;
  customerId?: string | undefined;
  plan?: PlanId | undefined;
  interval?: BillingInterval | undefined;
  status: "active" | "past_due" | "cancelled" | "incomplete";
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
  interval: BillingInterval;
  seats: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  /** For tax invoices, when the workspace has given them. */
  tax?: TaxDetails | null;
}

/** A price is set per plan and billing interval: "pro" monthly, "pro_yearly" yearly. */
export type PriceKey = PlanId | `${PlanId}_yearly`;
export const priceKey = (plan: PlanId, interval: BillingInterval): PriceKey =>
  interval === "year" ? `${plan}_yearly` : plan;

export interface PaymentProvider {
  name: "stripe" | "razorpay";
  /** A page where the person pays for a new subscription. */
  checkout(input: CheckoutInput): Promise<{ url: string; subscriptionId?: string }>;
  /** Whether a price is set up for this plan and interval. */
  offers(plan: PlanId, interval: BillingInterval): boolean;
  /** Switches an existing subscription to another plan or interval (prorated). */
  changePlan(
    account: BillingAccountRow,
    plan: PlanId,
    seats: number,
    interval: BillingInterval,
  ): Promise<void>;
  updateSeats(account: BillingAccountRow, seats: number): Promise<void>;
  /** Cancels at the end of the period, or undoes that. */
  setCancelAtPeriodEnd(account: BillingAccountRow, cancel: boolean): Promise<void>;
  /** Ends the subscription now, with no further charges (the workspace is being deleted). */
  cancelNow(account: BillingAccountRow): Promise<void>;
  /** The provider's own page for payment methods and invoices, when it has one. */
  portal?(account: BillingAccountRow, returnUrl: string): Promise<string>;
  /**
   * Adds extra usage to the next invoice, or with `now`, bills it at once on
   * its own invoice (yearly plans, whose next invoice is months away).
   */
  chargeExtra(
    account: BillingAccountRow,
    input: {
      amountNanoUsd: number;
      description: string;
      invoiceId?: string | undefined;
      now?: boolean;
      /** Makes a retried charge a no-op. */
      key?: string;
    },
  ): Promise<void>;
  /** Puts the business's name and tax ID on the customer, so invoices show them. */
  setTaxDetails?(account: BillingAccountRow, tax: TaxDetails): Promise<void>;
  /** Recent invoices, newest first. */
  listInvoices(account: BillingAccountRow): Promise<Invoice[]>;
  /** Verifies the signature and reads the event; null when it isn't genuine. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookEvent | null;
}

export class PaymentProviderError extends Error {}

const TIMEOUT_MS = 15_000;

const sameHex = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Which plan and interval a provider's price or plan ID is for. */
function planFromIds(
  map: Partial<Record<PriceKey, string>>,
  id: string | undefined,
): { plan: PlanId; interval: BillingInterval } | undefined {
  const key = (Object.entries(map) as [PriceKey, string | undefined][]).find(
    ([, value]) => value && value === id,
  )?.[0];
  if (!key) return undefined;
  return key.endsWith("_yearly")
    ? { plan: key.slice(0, -"_yearly".length) as PlanId, interval: "year" }
    : { plan: key as PlanId, interval: "month" };
}

const seconds = (value: unknown) =>
  typeof value === "number" && value > 0 ? new Date(value * 1000) : undefined;

/* ---------------------------------- Stripe ---------------------------------- */

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Price IDs for each paid plan, monthly ("pro") and yearly ("pro_yearly"). */
  prices: Partial<Record<PriceKey, string | undefined>>;
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
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await fetcher(`${base}/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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

  const priceFor = (plan: PlanId, interval: BillingInterval) => {
    const price = config.prices[priceKey(plan, interval)];
    if (!price) {
      throw new PaymentProviderError(
        `No Stripe price is set for the ${plan} plan${interval === "year" ? " billed yearly" : ""}`,
      );
    }
    return price;
  };

  // Stripe spells it "canceled"; Tessel uses "cancelled" everywhere.
  const status = (value: string): SubscriptionUpdate["status"] =>
    value === "active" || value === "trialing"
      ? "active"
      : value === "past_due" || value === "unpaid"
        ? "past_due"
        : value === "canceled" || value === "incomplete_expired"
          ? "cancelled"
          : "incomplete";

  function toUpdate(subscription: StripeSubscription, deleted = false): SubscriptionUpdate {
    const item = subscription.items?.data[0];
    const priced = planFromIds(config.prices, item?.price?.id);
    return {
      kind: "subscription",
      workspaceId: subscription.metadata?.workspaceId,
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      // The price is the truth: a plan change updates it but not the metadata.
      plan: priced?.plan ?? (subscription.metadata?.plan as PlanId | undefined),
      interval: priced?.interval,
      status: deleted ? "cancelled" : status(subscription.status),
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

    offers: (plan, interval) => Boolean(config.prices[priceKey(plan, interval)]),

    async checkout(input) {
      const session = await call<{ id: string; url: string }>("POST", "/checkout/sessions", {
        mode: "subscription",
        line_items: { 0: { price: priceFor(input.plan, input.interval), quantity: input.seats } },
        client_reference_id: input.workspaceId,
        ...(input.customerId
          ? // Saves the name and tax ID entered at checkout to the existing customer.
            { customer: input.customerId, customer_update: { name: "auto", address: "auto" } }
          : { customer_email: input.email }),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        allow_promotion_codes: true,
        // Businesses can enter a tax ID (a GSTIN, a VAT number) for their invoices.
        tax_id_collection: { enabled: true },
        metadata: { workspaceId: input.workspaceId, plan: input.plan },
        subscription_data: { metadata: { workspaceId: input.workspaceId, plan: input.plan } },
      });
      return { url: session.url };
    },

    async changePlan(account, plan, seats, interval) {
      const item = await firstItem(account.subscriptionId!);
      await call("POST", `/subscriptions/${account.subscriptionId}`, {
        items: { 0: { id: item.id, price: priceFor(plan, interval), quantity: seats } },
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

    async chargeExtra(account, { amountNanoUsd, description, invoiceId, now, key }) {
      const cents = Math.ceil(amountNanoUsd / 10_000_000);
      if (cents <= 0) return;
      // A retried webhook or a timeout must never add the same charge twice.
      const idempotency = `extra-usage:${account.subscriptionId}:${key ?? invoiceId ?? description}`;
      if (now) {
        // Its own invoice, paid with the card on file.
        const invoice = await call<{ id: string }>(
          "POST",
          "/invoices",
          {
            customer: account.customerId,
            collection_method: "charge_automatically",
            auto_advance: true,
            description,
            metadata: { workspaceId: account.workspaceId, kind: "extra_usage" },
          },
          `${idempotency}:invoice`,
        );
        await call(
          "POST",
          "/invoiceitems",
          {
            customer: account.customerId,
            amount: cents,
            currency: "usd",
            description,
            invoice: invoice.id,
          },
          idempotency,
        );
        await call("POST", `/invoices/${invoice.id}/finalize`, {}, `${idempotency}:finalize`);
        return;
      }
      await call(
        "POST",
        "/invoiceitems",
        {
          customer: account.customerId,
          amount: cents,
          currency: "usd",
          description,
          ...(invoiceId ? { invoice: invoiceId } : { subscription: account.subscriptionId }),
        },
        idempotency,
      );
    },

    async setTaxDetails(account, tax) {
      if (!account.customerId) return;
      await call("POST", `/customers/${account.customerId}`, { name: tax.name });
      const existing = await call<{ data: { id: string; type: string; value: string }[] }>(
        "GET",
        `/customers/${account.customerId}/tax_ids`,
      );
      const gst = existing.data.filter((item) => item.type === "in_gst");
      for (const item of gst) {
        if (item.value !== tax.taxId) {
          await call("DELETE", `/customers/${account.customerId}/tax_ids/${item.id}`);
        }
      }
      if (tax.taxId && !gst.some((item) => item.value === tax.taxId)) {
        await call("POST", `/customers/${account.customerId}/tax_ids`, {
          type: "in_gst",
          value: tax.taxId,
        });
      }
    },

    async listInvoices(account) {
      if (!account.customerId) return [];
      const list = await call<{
        data: {
          id: string;
          number: string | null;
          created: number;
          total: number;
          currency: string;
          status: string | null;
          hosted_invoice_url?: string | null;
        }[];
      }>("GET", `/invoices?customer=${encodeURIComponent(account.customerId)}&limit=24`);
      return list.data
        .filter((invoice) => invoice.status !== "draft")
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          createdAt: new Date(invoice.created * 1000).toISOString(),
          amount: invoice.total,
          currency: invoice.currency.toUpperCase(),
          status: invoice.status ?? "open",
          url: invoice.hosted_invoice_url ?? null,
        }));
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
  /** Plan IDs for each paid plan, monthly ("pro") and yearly ("pro_yearly"). */
  plans: Partial<Record<PriceKey, string | undefined>>;
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
    method: "GET" | "POST" | "PATCH" | "PUT",
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

  const planFor = (plan: PlanId, interval: BillingInterval) => {
    const id = config.plans[priceKey(plan, interval)];
    if (!id) {
      throw new PaymentProviderError(
        `No Razorpay plan is set for the ${plan} plan${interval === "year" ? " billed yearly" : ""}`,
      );
    }
    return id;
  };

  const status = (value: string): SubscriptionUpdate["status"] =>
    value === "active" || value === "authenticated"
      ? "active"
      : value === "pending" || value === "halted"
        ? "past_due"
        : value === "cancelled" || value === "completed" || value === "expired"
          ? "cancelled"
          : "incomplete";

  function toUpdate(subscription: RazorpaySubscription): SubscriptionUpdate {
    const notes = Array.isArray(subscription.notes) ? {} : (subscription.notes ?? {});
    const priced = planFromIds(config.plans, subscription.plan_id);
    return {
      kind: "subscription",
      workspaceId: notes.workspaceId,
      subscriptionId: subscription.id,
      customerId: subscription.customer_id ?? undefined,
      // The plan ID is the truth: a plan change updates it but not the notes.
      plan: priced?.plan ?? (notes.plan as PlanId | undefined),
      interval: priced?.interval,
      status: status(subscription.status),
      seats: subscription.quantity,
      periodStart: seconds(subscription.current_start),
      periodEnd: seconds(subscription.current_end),
    };
  }

  return {
    name: "razorpay",

    offers: (plan, interval) => Boolean(config.plans[priceKey(plan, interval)]),

    async checkout(input) {
      // A customer with the business's name and GSTIN, so Razorpay's invoices carry them.
      const customer = input.tax
        ? await call<{ id: string }>("POST", "/customers", {
            name: input.tax.name,
            email: input.email,
            ...(input.tax.taxId ? { gstin: input.tax.taxId } : {}),
            fail_existing: 0,
            notes: { workspaceId: input.workspaceId },
          })
        : undefined;
      const subscription = await call<RazorpaySubscription>("POST", "/subscriptions", {
        plan_id: planFor(input.plan, input.interval),
        // Up to ten years either way; cancelled from Tessel.
        total_count: input.interval === "year" ? 10 : 120,
        quantity: input.seats,
        customer_notify: 1,
        ...(customer ? { customer_id: customer.id } : {}),
        notes: {
          workspaceId: input.workspaceId,
          plan: input.plan,
          email: input.email,
          ...(input.tax?.taxId ? { gstin: input.tax.taxId } : {}),
        },
      });
      if (!subscription.short_url) throw new PaymentProviderError("Razorpay sent no payment link");
      return { url: subscription.short_url, subscriptionId: subscription.id };
    },

    async changePlan(account, plan, seats, interval) {
      await call("PATCH", `/subscriptions/${account.subscriptionId}`, {
        plan_id: planFor(plan, interval),
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

    async setTaxDetails(account, tax) {
      if (!account.customerId) return;
      await call("PUT", `/customers/${account.customerId}`, {
        name: tax.name,
        gstin: tax.taxId ?? "",
      });
    },

    async listInvoices(account) {
      if (!account.subscriptionId) return [];
      const list = await call<{
        items: {
          id: string;
          invoice_number?: string | null;
          issued_at?: number | null;
          created_at: number;
          amount: number;
          currency: string;
          status: string;
          short_url?: string | null;
        }[];
      }>("GET", `/invoices?subscription_id=${encodeURIComponent(account.subscriptionId)}&count=24`);
      return list.items.map((invoice) => ({
        id: invoice.id,
        number: invoice.invoice_number ?? null,
        createdAt: new Date((invoice.issued_at ?? invoice.created_at) * 1000).toISOString(),
        amount: invoice.amount,
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        url: invoice.short_url || null,
      }));
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
