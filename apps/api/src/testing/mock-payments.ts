import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Stand-ins for Stripe and Razorpay, for development and tests. They answer
 * the API calls Tessel makes, show a "pay" page, and send signed webhooks
 * back to the API like the real providers do.
 */
export interface MockPayments {
  url: string;
  /** Invoice items (Stripe) and add-ons (Razorpay) charged so far. */
  charges: {
    provider: "stripe" | "razorpay";
    subscriptionId: string;
    amount: number;
    currency: string;
    /** Stripe: billed at once on its own invoice, not with the next renewal. */
    invoiceId?: string;
  }[];
  /** Customers' names and tax IDs, as Tessel set them. */
  customers: Map<string, { name?: string; email?: string; taxIds: string[] }>;
  /** Starts a new billing period for a subscription, as a renewal would. */
  renew(provider: "stripe" | "razorpay", subscriptionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface MockPaymentsOptions {
  port?: number;
  host?: string;
  /** Where to post webhooks: the API's /billing/webhooks base. */
  webhookUrl: string;
  stripeWebhookSecret: string;
  razorpayWebhookSecret: string;
}

interface Subscription {
  id: string;
  provider: "stripe" | "razorpay";
  customer: string;
  status: string;
  plan: string;
  quantity: number;
  metadata: Record<string, string>;
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
  itemId: string;
  shortUrl?: string;
}

const DAY = 86_400;
/** A yearly price or plan has "yearly" in its ID in the mock. */
const periodOf = (plan: string) => (plan.includes("yearly") ? 365 * DAY : 30 * DAY);
const id = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

/** Reads Stripe-style form fields (a[b][0][c]=value) into a flat map. */
const form = (body: string) => Object.fromEntries(new URLSearchParams(body));

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px system-ui;max-width:26rem;margin:3rem auto;padding:0 1rem}button{padding:.6rem 1rem;font:inherit;margin-top:1rem}</style></head><body>${body}</body></html>`;
}

export async function startMockPayments(options: MockPaymentsOptions): Promise<MockPayments> {
  const subscriptions = new Map<string, Subscription>();
  const sessions = new Map<
    string,
    {
      price: string;
      quantity: number;
      metadata: Record<string, string>;
      success: string;
      cancel: string;
      email?: string;
    }
  >();
  const charges: MockPayments["charges"] = [];
  const customers: MockPayments["customers"] = new Map();
  const invoices: {
    id: string;
    provider: "stripe" | "razorpay";
    customer: string;
    subscription?: string;
    amount: number;
    currency: string;
    status: string;
    created: number;
  }[] = [];
  const customer = (key: string) => {
    let found = customers.get(key);
    if (!found) {
      found = { taxIds: [] };
      customers.set(key, found);
    }
    return found;
  };

  function stripeSubscription(sub: Subscription) {
    return {
      id: sub.id,
      object: "subscription",
      customer: sub.customer,
      status: sub.status,
      metadata: sub.metadata,
      cancel_at_period_end: sub.cancelAtPeriodEnd,
      items: {
        data: [
          {
            id: sub.itemId,
            quantity: sub.quantity,
            price: { id: sub.plan },
            current_period_start: sub.periodStart,
            current_period_end: sub.periodEnd,
          },
        ],
      },
    };
  }

  function razorpaySubscription(sub: Subscription) {
    return {
      id: sub.id,
      entity: "subscription",
      plan_id: sub.plan,
      customer_id: sub.customer,
      status: sub.status,
      quantity: sub.quantity,
      current_start: sub.periodStart,
      current_end: sub.periodEnd,
      notes: sub.metadata,
      short_url: sub.shortUrl,
    };
  }

  async function sendStripe(type: string, object: unknown) {
    const body = JSON.stringify({ id: id("evt"), type, data: { object } });
    const timestamp = nowSeconds();
    const signature = createHmac("sha256", options.stripeWebhookSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    await fetch(`${options.webhookUrl}/stripe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${timestamp},v1=${signature}`,
      },
      body,
    });
  }

  async function sendRazorpay(event: string, sub: Subscription) {
    const body = JSON.stringify({
      entity: "event",
      event,
      created_at: nowSeconds(),
      payload: { subscription: { entity: razorpaySubscription(sub) } },
    });
    const signature = createHmac("sha256", options.razorpayWebhookSecret)
      .update(body)
      .digest("hex");
    await fetch(`${options.webhookUrl}/razorpay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": signature,
        "X-Razorpay-Event-Id": id("evt"),
      },
      body,
    });
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const html = (body: string) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    };
    const redirect = (to: string) => {
      res.writeHead(303, { Location: to });
      res.end();
    };

    if (url.pathname === "/health") return json(200, { status: "ok" });
    const [provider, ...rest] = parts;
    const path = rest.join("/");

    if (provider === "stripe") {
      // Pages the browser sees.
      if (req.method === "GET" && rest[0] === "pay" && rest[1]) {
        const session = sessions.get(rest[1]);
        if (!session) return json(404, { error: "no session" });
        return html(
          page(
            "Mock Stripe checkout",
            `<h1>Mock Stripe checkout</h1><p>${session.quantity} × ${session.price}</p><form method="post"><button type="submit">Pay</button></form><p><a href="${session.cancel}">Cancel</a></p>`,
          ),
        );
      }
      if (req.method === "POST" && rest[0] === "pay" && rest[1]) {
        const session = sessions.get(rest[1]);
        if (!session) return json(404, { error: "no session" });
        const sub: Subscription = {
          id: id("sub"),
          provider: "stripe",
          customer: id("cus"),
          status: "active",
          plan: session.price,
          quantity: session.quantity,
          metadata: session.metadata,
          periodStart: nowSeconds(),
          periodEnd: nowSeconds() + periodOf(session.price),
          cancelAtPeriodEnd: false,
          itemId: id("si"),
        };
        subscriptions.set(sub.id, sub);
        sessions.delete(rest[1]);
        customer(sub.customer).email = session.email ?? "";
        invoices.push({
          id: id("in"),
          provider: "stripe",
          customer: sub.customer,
          subscription: sub.id,
          amount: sub.quantity * 2000,
          currency: "usd",
          status: "paid",
          created: nowSeconds(),
        });
        await sendStripe("checkout.session.completed", { id: rest[1], subscription: sub.id });
        await sendStripe("customer.subscription.created", stripeSubscription(sub));
        return redirect(session.success);
      }
      if (req.method === "GET" && rest[0] === "portal") {
        return html(
          page(
            "Mock Stripe portal",
            `<h1>Mock Stripe billing portal</h1><p><a href="${url.searchParams.get("return") ?? "/"}">Return</a></p>`,
          ),
        );
      }

      if (!(req.headers.authorization ?? "").startsWith("Bearer "))
        return json(401, { error: { message: "No key" } });
      const fields = form(req.method === "POST" ? await readBody(req) : "");
      if (rest[0] === "v1" && rest[1] === "customers" && rest[2]) {
        const found = customer(rest[2]);
        if (req.method === "POST" && rest[3] === undefined) {
          if (fields.name) found.name = fields.name;
          return json(200, { id: rest[2], name: found.name });
        }
        if (rest[3] === "tax_ids") {
          if (req.method === "GET") {
            return json(200, {
              data: found.taxIds.map((value, index) => ({
                id: `txi_${index}`,
                type: "in_gst",
                value,
              })),
            });
          }
          if (req.method === "POST") {
            found.taxIds.push(fields.value ?? "");
            return json(200, { id: `txi_${found.taxIds.length - 1}` });
          }
          if (req.method === "DELETE" && rest[4]) {
            found.taxIds.splice(Number(rest[4].slice(4)), 1);
            return json(200, { deleted: true });
          }
        }
      }
      if (req.method === "GET" && path === "v1/invoices") {
        const owner = url.searchParams.get("customer");
        return json(200, {
          data: invoices
            .filter((invoice) => invoice.provider === "stripe" && invoice.customer === owner)
            .reverse()
            .map((invoice) => ({
              id: invoice.id,
              number: invoice.id.toUpperCase(),
              created: invoice.created,
              total: invoice.amount,
              currency: invoice.currency,
              status: invoice.status,
              hosted_invoice_url: `${url.origin}/stripe/invoices/${invoice.id}`,
            })),
        });
      }
      if (req.method === "POST" && path === "v1/invoices") {
        const invoice = {
          id: id("in"),
          provider: "stripe" as const,
          customer: fields.customer ?? "",
          amount: 0,
          currency: "usd",
          status: "draft",
          created: nowSeconds(),
        };
        invoices.push(invoice);
        return json(200, { id: invoice.id });
      }
      if (req.method === "POST" && rest[1] === "invoices" && rest[3] === "finalize") {
        const invoice = invoices.find((item) => item.id === rest[2]);
        if (invoice) invoice.status = "open";
        return json(200, { id: rest[2], status: "open" });
      }
      if (req.method === "POST" && path === "v1/checkout/sessions") {
        const sessionId = id("cs");
        const metadata: Record<string, string> = {};
        for (const [key, value] of Object.entries(fields)) {
          const match = /^subscription_data\[metadata\]\[(\w+)\]$/.exec(key);
          if (match) metadata[match[1]!] = value;
        }
        sessions.set(sessionId, {
          price: fields["line_items[0][price]"] ?? "",
          quantity: Number(fields["line_items[0][quantity]"] ?? 1),
          metadata,
          success: fields.success_url ?? "/",
          cancel: fields.cancel_url ?? "/",
          ...(fields.customer_email ? { email: fields.customer_email } : {}),
        });
        return json(200, { id: sessionId, url: `${url.origin}/stripe/pay/${sessionId}` });
      }
      if (req.method === "POST" && path === "v1/billing_portal/sessions") {
        return json(200, {
          url: `${url.origin}/stripe/portal?return=${encodeURIComponent(fields.return_url ?? "/")}`,
        });
      }
      if (rest[0] === "v1" && rest[1] === "subscriptions" && rest[2]) {
        const sub = subscriptions.get(rest[2]);
        if (!sub) return json(404, { error: { message: "No such subscription" } });
        if (req.method === "DELETE") {
          sub.status = "canceled";
          await sendStripe("customer.subscription.deleted", stripeSubscription(sub));
          return json(200, stripeSubscription(sub));
        }
        if (req.method === "POST") {
          if (fields.cancel_at_period_end !== undefined)
            sub.cancelAtPeriodEnd = fields.cancel_at_period_end === "true";
          if (fields["items[0][quantity]"]) sub.quantity = Number(fields["items[0][quantity]"]);
          if (fields["items[0][price]"]) sub.plan = fields["items[0][price]"];
          if (fields["metadata[plan]"]) sub.metadata.plan = fields["metadata[plan]"];
          await sendStripe("customer.subscription.updated", stripeSubscription(sub));
        }
        return json(200, stripeSubscription(sub));
      }
      if (req.method === "POST" && path === "v1/invoiceitems") {
        const sub = [...subscriptions.values()].find((item) => item.customer === fields.customer);
        const own = invoices.find(
          (invoice) => invoice.id === fields.invoice && invoice.status === "draft",
        );
        if (own) own.amount += Number(fields.amount);
        charges.push({
          provider: "stripe",
          subscriptionId: sub?.id ?? "",
          amount: Number(fields.amount),
          currency: fields.currency ?? "usd",
          ...(own ? { invoiceId: own.id } : {}),
        });
        return json(200, { id: id("ii") });
      }
      return json(404, { error: { message: "Not found" } });
    }

    if (provider === "razorpay") {
      if (req.method === "GET" && rest[0] === "pay" && rest[1]) {
        const sub = subscriptions.get(rest[1]);
        if (!sub) return json(404, { error: "no subscription" });
        return html(
          page(
            "Mock Razorpay",
            `<h1>Mock Razorpay subscription</h1><p>${sub.quantity} × ${sub.plan}</p><form method="post"><button type="submit">Pay</button></form>`,
          ),
        );
      }
      if (req.method === "POST" && rest[0] === "pay" && rest[1]) {
        const sub = subscriptions.get(rest[1]);
        if (!sub) return json(404, { error: "no subscription" });
        sub.status = "active";
        sub.customer ||= id("cust");
        sub.periodStart = nowSeconds();
        sub.periodEnd = nowSeconds() + periodOf(sub.plan);
        invoices.push({
          id: id("inv"),
          provider: "razorpay",
          customer: sub.customer,
          subscription: sub.id,
          amount: sub.quantity * 195_000,
          currency: "INR",
          status: "paid",
          created: nowSeconds(),
        });
        await sendRazorpay("subscription.activated", sub);
        await sendRazorpay("subscription.charged", sub);
        return html(
          page(
            "Payment received",
            "<h1>Payment received</h1><p>You can go back to Tessel now.</p>",
          ),
        );
      }

      const expected = `Basic ${Buffer.from("rzp_test_key:rzp_test_secret").toString("base64")}`;
      if (req.headers.authorization !== expected) {
        return json(401, { error: { description: "Authentication failed" } });
      }
      const body =
        req.method === "GET"
          ? {}
          : (JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>);
      if (req.method === "POST" && path === "v1/customers") {
        const customerId = id("cust");
        const found = customer(customerId);
        found.name = String(body.name ?? "");
        found.email = String(body.email ?? "");
        if (body.gstin) found.taxIds = [String(body.gstin)];
        return json(200, { id: customerId, name: found.name, gstin: body.gstin ?? null });
      }
      if (req.method === "PUT" && rest[1] === "customers" && rest[2]) {
        const found = customer(rest[2]);
        if (body.name) found.name = String(body.name);
        found.taxIds = body.gstin ? [String(body.gstin)] : [];
        return json(200, { id: rest[2] });
      }
      if (req.method === "GET" && path === "v1/invoices") {
        const subscription = url.searchParams.get("subscription_id");
        return json(200, {
          items: invoices
            .filter(
              (invoice) => invoice.provider === "razorpay" && invoice.subscription === subscription,
            )
            .reverse()
            .map((invoice) => ({
              id: invoice.id,
              invoice_number: `TSL/${invoice.id.slice(-6)}`,
              created_at: invoice.created,
              issued_at: invoice.created,
              amount: invoice.amount,
              currency: invoice.currency,
              status: invoice.status,
              short_url: `${url.origin}/razorpay/invoices/${invoice.id}`,
            })),
        });
      }
      if (req.method === "POST" && path === "v1/subscriptions") {
        const sub: Subscription = {
          id: id("sub"),
          provider: "razorpay",
          customer: typeof body.customer_id === "string" ? body.customer_id : "",
          status: "created",
          plan: String(body.plan_id),
          quantity: Number(body.quantity ?? 1),
          metadata: (body.notes as Record<string, string>) ?? {},
          periodStart: 0,
          periodEnd: 0,
          cancelAtPeriodEnd: false,
          itemId: "",
        };
        sub.shortUrl = `${url.origin}/razorpay/pay/${sub.id}`;
        subscriptions.set(sub.id, sub);
        return json(200, razorpaySubscription(sub));
      }
      if (rest[0] === "v1" && rest[1] === "subscriptions" && rest[2]) {
        const sub = subscriptions.get(rest[2]);
        if (!sub) return json(400, { error: { description: "The id provided does not exist" } });
        if (req.method === "PATCH") {
          if (body.quantity) sub.quantity = Number(body.quantity);
          if (body.plan_id) sub.plan = String(body.plan_id);
          await sendRazorpay("subscription.updated", sub);
        }
        if (req.method === "POST" && rest[3] === "cancel") {
          if (Number(body.cancel_at_cycle_end) === 0) {
            sub.status = "cancelled";
            await sendRazorpay("subscription.cancelled", sub);
          } else {
            sub.cancelAtPeriodEnd = true;
          }
        }
        if (req.method === "POST" && rest[3] === "addons") {
          const item = body.item as { amount: number; currency: string };
          charges.push({
            provider: "razorpay",
            subscriptionId: sub.id,
            amount: item.amount,
            currency: item.currency,
          });
        }
        return json(200, razorpaySubscription(sub));
      }
      return json(404, { error: { description: "Not found" } });
    }
    return json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return {
    url: `http://${options.host ?? "127.0.0.1"}:${address.port}`,
    charges,
    customers,
    async renew(provider, subscriptionId) {
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`No subscription ${subscriptionId}`);
      const closedStart = sub.periodStart;
      const closedEnd = nowSeconds() + 1;
      sub.periodStart = closedEnd;
      sub.periodEnd = closedEnd + periodOf(sub.plan);
      if (provider === "stripe") {
        await sendStripe("invoice.created", {
          id: id("in"),
          subscription: sub.id,
          billing_reason: "subscription_cycle",
          period_start: closedStart,
          period_end: closedEnd,
        });
        await sendStripe("customer.subscription.updated", stripeSubscription(sub));
      } else {
        await sendRazorpay("subscription.charged", sub);
      }
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
