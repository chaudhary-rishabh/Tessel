import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { billingAccounts, extraUsageRequests, usageEvents } from "@tessel/db";
import { eq, sql } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { BillingService } from "../src/modules/billing/billing.service";
import { createRazorpayProvider, createStripeProvider } from "../src/modules/billing/providers";
import { startMockPayments, type MockPayments } from "../src/testing/mock-payments";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  signUp,
  testOutbox,
  type SignedUpUser,
} from "./helpers";

const STRIPE_SECRET = "whsec_test";
const RAZORPAY_SECRET = "rzp_webhook_test";
const DAY_MS = 86_400_000;
let gateway: MockGateway;
let payments: MockPayments;
let apiServer: Server;
let app: Express;
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

beforeAll(async () => {
  gateway = await startMockGateway();
  apiServer = await new Promise<Server>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
  const apiUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
  payments = await startMockPayments({
    webhookUrl: `${apiUrl}/billing/webhooks`,
    stripeWebhookSecret: STRIPE_SECRET,
    razorpayWebhookSecret: RAZORPAY_SECRET,
  });
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url }),
    payments: {
      stripe: createStripeProvider({
        secretKey: "sk_test",
        webhookSecret: STRIPE_SECRET,
        prices: {
          pro: "price_pro",
          max: "price_max",
          team: "price_team",
          pro_yearly: "price_pro_yearly",
        },
        baseUrl: `${payments.url}/stripe`,
      }),
      razorpay: createRazorpayProvider({
        keyId: "rzp_test_key",
        keySecret: "rzp_test_secret",
        webhookSecret: RAZORPAY_SECRET,
        plans: {
          pro: "plan_pro",
          max: "plan_max",
          team: "plan_team",
          pro_yearly: "plan_pro_yearly",
        },
        usdToInr: 85,
        baseUrl: `${payments.url}/razorpay`,
      }),
    },
  });
  apiServer.on("request", app);
});
afterAll(async () => {
  await gateway.close();
  await payments.close();
  apiServer.closeAllConnections();
  await new Promise((resolve) => apiServer.close(resolve));
});

async function personal(user: SignedUpUser) {
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  return res.body.workspaces[0].id as string;
}

async function pay(url: string) {
  const res = await fetch(url, { method: "POST", redirect: "manual" });
  expect([200, 303]).toContain(res.status);
}

const summary = async (user: SignedUpUser, workspaceId: string) =>
  (await request(app).get(`/workspaces/${workspaceId}/billing`).set("Authorization", bearer(user)))
    .body;

const accountOf = async (workspaceId: string) =>
  (
    await ownerDb()
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.workspaceId, workspaceId))
  )[0]!;

async function subscribe(
  user: SignedUpUser,
  workspaceId: string,
  body: { plan: string; provider: string; interval?: string },
) {
  const checkout = await request(app)
    .post(`/workspaces/${workspaceId}/billing/checkout`)
    .set("Authorization", bearer(user))
    .send(body);
  expect(checkout.status).toBe(200);
  await pay(checkout.body.url);
}

const ask = (user: SignedUpUser, workspaceId: string) =>
  request(app)
    .post(`/workspaces/${workspaceId}/completions`)
    .set("Authorization", bearer(user))
    .send({ messages: [{ role: "user", content: "Hi" }] });

/** Spends as if requests had been made, to reach a limit without making them. */
async function spend(
  user: SignedUpUser,
  workspaceId: string,
  costNanoUsd: number,
  extraRequestId?: string,
) {
  if (extraRequestId) {
    await ownerDb()
      .insert(extraUsageRequests)
      .values({ requestId: extraRequestId, workspaceId, userId: user.auth.user.id });
  }
  await ownerDb()
    .insert(usageEvents)
    .values({
      workspaceId,
      userId: user.auth.user.id,
      feature: "chat",
      modelId: "openai/gpt-5.4-mini",
      route: "gateway",
      status: "ok",
      costNanoUsd,
      ...(extraRequestId ? { requestId: extraRequestId } : {}),
    });
}

describe("yearly plans", () => {
  it("bills a year at once, and last month's extra usage on its own invoice each month", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    expect((await summary(user, workspaceId)).yearly).toEqual({ stripe: true, razorpay: true });

    await subscribe(user, workspaceId, { plan: "pro", provider: "stripe", interval: "year" });
    const paid = await summary(user, workspaceId);
    expect(paid).toMatchObject({ plan: "pro", interval: "year", provider: "stripe" });
    expect(new Date(paid.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now() + 360 * DAY_MS);
    expect(paid.extraUsage).toMatchObject({ available: true, unavailableReason: null });
    await request(app)
      .put(`/workspaces/${workspaceId}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 50 });

    // Forty days into the year, with $1.50 of extra usage from twenty days ago.
    await spend(user, workspaceId, 1_500_000_000, `extra-${workspaceId}`);
    await ownerDb().execute(
      sql`UPDATE extra_usage_requests SET created_at = now() - interval '20 days' WHERE workspace_id = ${workspaceId}`,
    );
    await ownerDb().execute(
      sql`UPDATE usage_events SET created_at = now() - interval '20 days' WHERE workspace_id = ${workspaceId}`,
    );
    await ownerDb()
      .update(billingAccounts)
      .set({ currentPeriodStart: new Date(Date.now() - 40 * DAY_MS) })
      .where(eq(billingAccounts.workspaceId, workspaceId));

    const billing = app.locals.billing as BillingService;
    await billing.chargeYearlyExtras();
    const account = await accountOf(workspaceId);
    const charges = payments.charges.filter(
      (item) => item.subscriptionId === account.subscriptionId,
    );
    expect(charges).toEqual([
      expect.objectContaining({ amount: 150, currency: "usd", invoiceId: expect.any(String) }),
    ]);
    expect(account.extraChargedThrough!.getTime()).toBeGreaterThan(Date.now() - 11 * DAY_MS);

    // Running again, as every server does each hour, charges nothing more.
    await billing.chargeYearlyExtras();
    expect(
      payments.charges.filter((item) => item.subscriptionId === account.subscriptionId),
    ).toHaveLength(1);

    const invoices = await request(app)
      .get(`/workspaces/${workspaceId}/billing/invoices`)
      .set("Authorization", bearer(user));
    expect(invoices.body.invoices.map((invoice: { amount: number }) => invoice.amount)).toEqual([
      150, 2000,
    ]);
    expect(invoices.body.invoices[0]).toMatchObject({ currency: "USD", status: "open" });
    expect(invoices.body.invoices[0].url).toContain("/stripe/invoices/");
  });

  it("doesn't offer extra usage on a yearly plan paid with Razorpay", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    await subscribe(user, workspaceId, { plan: "pro", provider: "razorpay", interval: "year" });
    expect((await summary(user, workspaceId)).extraUsage).toMatchObject({
      available: false,
      unavailableReason: "razorpay_yearly",
    });
    const res = await request(app)
      .put(`/workspaces/${workspaceId}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 20 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      "Extra usage needs monthly billing when you pay with Razorpay.",
    );
  });

  it("explains when a plan has no yearly price", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const res = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "max", provider: "stripe", interval: "year" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("No Stripe price is set for the max plan billed yearly");
  });
});

describe("tax invoices", () => {
  it("checks a GSTIN, finds its state, and puts it on the Razorpay customer", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const put = (body: object) =>
      request(app)
        .put(`/workspaces/${workspaceId}/billing/tax`)
        .set("Authorization", bearer(user))
        .send(body);

    const bad = await put({ name: "Acme Pvt Ltd", taxId: "27AAPFU0939F1ZW" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].message).toBe(
      "This GSTIN isn't valid. Check it against your GST certificate.",
    );
    const saved = await put({ name: "Acme Pvt Ltd", taxId: "27aapfu0939f1zv" });
    expect(saved.body.tax).toEqual({
      name: "Acme Pvt Ltd",
      taxId: "27AAPFU0939F1ZV",
      state: "Maharashtra",
    });

    await subscribe(user, workspaceId, { plan: "pro", provider: "razorpay" });
    const account = await accountOf(workspaceId);
    expect(payments.customers.get(account.customerId!)).toMatchObject({
      name: "Acme Pvt Ltd",
      taxIds: ["27AAPFU0939F1ZV"],
    });
    const invoices = await request(app)
      .get(`/workspaces/${workspaceId}/billing/invoices`)
      .set("Authorization", bearer(user));
    expect(invoices.body.invoices).toEqual([
      expect.objectContaining({ amount: 195_000, currency: "INR", status: "paid" }),
    ]);

    // Changing it later updates the customer too; clearing the GSTIN removes it.
    await put({ name: "Acme Private Limited", taxId: "" });
    expect(payments.customers.get(account.customerId!)).toMatchObject({
      name: "Acme Private Limited",
      taxIds: [],
    });
    expect((await summary(user, workspaceId)).tax).toEqual({
      name: "Acme Private Limited",
      taxId: null,
      state: null,
    });
  });

  it("adds the GSTIN to an existing Stripe customer", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    await subscribe(user, workspaceId, { plan: "pro", provider: "stripe" });
    await request(app)
      .put(`/workspaces/${workspaceId}/billing/tax`)
      .set("Authorization", bearer(user))
      .send({ name: "Chennai Works", taxId: "33AAACH7409R1Z8" });
    const account = await accountOf(workspaceId);
    expect(payments.customers.get(account.customerId!)).toMatchObject({
      name: "Chennai Works",
      taxIds: ["33AAACH7409R1Z8"],
    });
    expect((await summary(user, workspaceId)).tax.state).toBe("Tamil Nadu");
  });
});

describe("usage alerts", () => {
  const sentTo = (email: string, subject: string) =>
    testOutbox.messages.filter((message) => message.to === email && message.subject === subject);

  it("emails a person once when they reach 80% of their weekly limit", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    expect((await ask(user, workspaceId)).status).toBe(200);
    // The free plan's week is $2: this brings it to 85%.
    await spend(user, workspaceId, 1_700_000_000);
    await ask(user, workspaceId);
    const subject = "You've used 85% of your weekly Tessel limit";
    await expect.poll(() => sentTo(user.auth.user.email, subject)).toHaveLength(1);
    expect(sentTo(user.auth.user.email, subject)[0]!.text).toContain("upgrade your plan");

    await ask(user, workspaceId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(sentTo(user.auth.user.email, subject)).toHaveLength(1);
  });

  it("emails owners when extra usage reaches 80% of its cap", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    await subscribe(user, workspaceId, { plan: "pro", provider: "stripe" });
    await request(app)
      .put(`/workspaces/${workspaceId}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 5 });
    expect((await ask(user, workspaceId)).status).toBe(200);
    // Past the five-hour limit, with $4.50 of the $5 cap already spent.
    await spend(user, workspaceId, 4_100_000_000);
    await spend(user, workspaceId, 4_500_000_000, `cap-${workspaceId}`);
    expect((await ask(user, workspaceId)).status).toBe(200);
    await expect
      .poll(
        () =>
          testOutbox.messages.filter(
            (message) =>
              message.to === user.auth.user.email &&
              message.subject.endsWith("has used most of its extra usage cap"),
          ).length,
      )
      .toBe(1);
    const message = testOutbox.messages.findLast((item) =>
      item.subject.endsWith("has used most of its extra usage cap"),
    )!;
    expect(message.text).toContain("$4.50 of its $5.00 monthly extra usage cap");
  });
});
