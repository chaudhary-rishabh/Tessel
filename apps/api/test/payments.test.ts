import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { billingAccounts, usageEvents } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createRazorpayProvider, createStripeProvider } from "../src/modules/billing/providers";
import { startMockPayments, type MockPayments } from "../src/testing/mock-payments";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  signUp,
  testOutbox,
  uniqueEmail,
  type SignedUpUser,
} from "./helpers";

const STRIPE_SECRET = "whsec_test";
const RAZORPAY_SECRET = "rzp_webhook_test";
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
        prices: { pro: "price_pro", max: "price_max", team: "price_team" },
        baseUrl: `${payments.url}/stripe`,
      }),
      razorpay: createRazorpayProvider({
        keyId: "rzp_test_key",
        keySecret: "rzp_test_secret",
        webhookSecret: RAZORPAY_SECRET,
        plans: { pro: "plan_pro", max: "plan_max", team: "plan_team" },
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

/** Plays the browser on the provider's payment page. */
async function pay(url: string) {
  const res = await fetch(url, { method: "POST", redirect: "manual" });
  expect([200, 303]).toContain(res.status);
}

async function summary(user: SignedUpUser, workspaceId: string) {
  return (
    await request(app).get(`/workspaces/${workspaceId}/billing`).set("Authorization", bearer(user))
  ).body;
}

describe("paying with Stripe", () => {
  it("subscribes to Pro from checkout, then cancels at the end of the period", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    expect((await summary(user, workspaceId)).providers).toEqual({ stripe: true, razorpay: true });

    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "pro", provider: "stripe" });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toContain("/stripe/pay/");
    await pay(checkout.body.url);

    const paid = await summary(user, workspaceId);
    expect(paid).toMatchObject({
      plan: "pro",
      status: "active",
      provider: "stripe",
      cancelAtPeriodEnd: false,
    });
    expect(new Date(paid.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const cancel = await request(app)
      .post(`/workspaces/${workspaceId}/billing/cancel`)
      .set("Authorization", bearer(user))
      .send({ cancel: true });
    expect(cancel.body).toMatchObject({ plan: "pro", cancelAtPeriodEnd: true });

    const portal = await request(app)
      .post(`/workspaces/${workspaceId}/billing/portal`)
      .set("Authorization", bearer(user));
    expect(portal.body.url).toContain("/stripe/portal");
  });

  it("switches plans on the existing subscription instead of a second checkout", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const first = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "pro", provider: "stripe" });
    await pay(first.body.url);
    const upgrade = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "max", provider: "stripe" });
    expect(upgrade.body.url).toBeNull();
    expect((await summary(user, workspaceId)).plan).toBe("max");
  });

  it("charges extra usage on the next invoice when a period closes", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "pro", provider: "stripe" });
    await pay(checkout.body.url);
    await request(app)
      .put(`/workspaces/${workspaceId}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 50 });

    const ask = () =>
      request(app)
        .post(`/workspaces/${workspaceId}/completions`)
        .set("Authorization", bearer(user))
        .send({ messages: [{ role: "user", content: "Hi" }] });
    expect((await ask()).status).toBe(200);
    // Use up the five-hour limit, then the next request is extra usage.
    await ownerDb().insert(usageEvents).values({
      workspaceId,
      userId: user.auth.user.id,
      feature: "chat",
      modelId: "openai/gpt-5.4-mini",
      route: "gateway",
      status: "ok",
      costNanoUsd: 4_000_000_000,
    });
    expect((await ask()).status).toBe(200);

    const [account] = await ownerDb()
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.workspaceId, workspaceId));
    await payments.renew("stripe", account!.subscriptionId!);
    const charge = payments.charges.find((item) => item.subscriptionId === account!.subscriptionId);
    expect(charge).toMatchObject({ provider: "stripe", currency: "usd" });
    expect(charge!.amount).toBeGreaterThanOrEqual(1);
  });

  it("ends the subscription at once when its workspace is deleted", async () => {
    const owner = await signUp(app);
    const team = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(owner))
      .send({ name: "Wind-down" });
    const workspaceId = team.body.id as string;
    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(owner))
      .send({ plan: "team", provider: "stripe" });
    await pay(checkout.body.url);
    const [account] = await ownerDb()
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.workspaceId, workspaceId));

    const removed = await request(app)
      .delete(`/workspaces/${workspaceId}`)
      .set("Authorization", bearer(owner))
      .send({ name: "Wind-down" });
    expect(removed.status).toBe(204);
    const subscription = await fetch(
      `${payments.url}/stripe/v1/subscriptions/${account!.subscriptionId}`,
      { headers: { Authorization: "Bearer sk_test" } },
    );
    expect(((await subscription.json()) as { status: string }).status).toBe("canceled");
    expect(
      await ownerDb()
        .select()
        .from(billingAccounts)
        .where(eq(billingAccounts.workspaceId, workspaceId)),
    ).toHaveLength(0);

    // A late event about it is acknowledged, so the provider stops retrying.
    const body = JSON.stringify({
      id: `evt_late_${workspaceId}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_gone",
          customer: "cus_gone",
          status: "active",
          metadata: { workspaceId, plan: "team" },
          items: { data: [{ quantity: 2, price: { id: "price_team" } }] },
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", STRIPE_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const late = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", `t=${timestamp},v1=${signature}`)
      .send(body);
    expect(late.status).toBe(200);
  });

  it("refuses webhooks with a bad signature, and applies a repeated one once", async () => {
    const body = JSON.stringify({
      id: "evt_forged",
      type: "customer.subscription.deleted",
      data: { object: {} },
    });
    const forged = await request(app)
      .post("/billing/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("Stripe-Signature", `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`)
      .send(body);
    expect(forged.status).toBe(400);

    const timestamp = Math.floor(Date.now() / 1000);
    const valid = createHmac("sha256", STRIPE_SECRET).update(`${timestamp}.${body}`).digest("hex");
    for (let delivery = 0; delivery < 2; delivery += 1) {
      const res = await request(app)
        .post("/billing/webhooks/stripe")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", `t=${timestamp},v1=${valid}`)
        .send(body);
      expect(res.status).toBe(200);
    }
  });
});

describe("paying with Razorpay", () => {
  it("subscribes a team workspace with a seat for each member, and adds seats as people join", async () => {
    const owner = await signUp(app);
    const team = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(owner))
      .send({ name: "Studio" });
    const workspaceId = team.body.id as string;

    const wrongPlan = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(owner))
      .send({ plan: "pro", provider: "razorpay" });
    expect(wrongPlan.body.error.code).toBe("plan_not_for_workspace");

    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(owner))
      .send({ plan: "team", provider: "razorpay" });
    expect(checkout.body.url).toContain("/razorpay/pay/");
    await pay(checkout.body.url);
    expect(await summary(owner, workspaceId)).toMatchObject({
      plan: "team",
      provider: "razorpay",
      seats: 2,
    });

    // Two more people join: the subscription grows to three seats.
    for (const name of ["One", "Two"]) {
      const email = uniqueEmail(name.toLowerCase());
      await request(app)
        .post(`/workspaces/${workspaceId}/invitations`)
        .set("Authorization", bearer(owner))
        .send({ email });
      const token = /\/invite\/([\w-]+)/.exec(testOutbox.latest(email)!.text)![1]!;
      const member = await signUp(app, { email });
      await request(app).post(`/invitations/${token}/accept`).set("Authorization", bearer(member));
    }
    expect((await summary(owner, workspaceId)).seats).toBe(3);
  });

  it("switches plans on the subscription, and the new plan is what applies", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "max", provider: "razorpay" });
    await pay(checkout.body.url);
    expect((await summary(user, workspaceId)).plan).toBe("max");

    // The checkout's notes still say "max"; the plan ID on the subscription wins.
    const change = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "pro", provider: "razorpay" });
    expect(change.body.url).toBeNull();
    expect((await summary(user, workspaceId)).plan).toBe("pro");
  });

  it("marks the plan past due when a payment fails, and free once it's cancelled", async () => {
    const user = await signUp(app);
    const workspaceId = await personal(user);
    const checkout = await request(app)
      .post(`/workspaces/${workspaceId}/billing/checkout`)
      .set("Authorization", bearer(user))
      .send({ plan: "pro", provider: "razorpay" });
    await pay(checkout.body.url);
    const [account] = await ownerDb()
      .select()
      .from(billingAccounts)
      .where(eq(billingAccounts.workspaceId, workspaceId));

    const send = async (event: string, status: string) => {
      const body = JSON.stringify({
        event,
        created_at: Date.now(),
        payload: {
          subscription: {
            entity: {
              id: account!.subscriptionId,
              plan_id: "plan_pro",
              status,
              notes: { workspaceId, plan: "pro" },
            },
          },
        },
      });
      return request(app)
        .post("/billing/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set(
          "X-Razorpay-Signature",
          createHmac("sha256", RAZORPAY_SECRET).update(body).digest("hex"),
        )
        .set("X-Razorpay-Event-Id", `evt_${event}_${Date.now()}`)
        .send(body);
    };
    await send("subscription.halted", "halted");
    expect((await summary(user, workspaceId)).status).toBe("past_due");
    await send("subscription.cancelled", "cancelled");
    expect(await summary(user, workspaceId)).toMatchObject({ plan: "free", status: "cancelled" });
  });

  it("only lets owners and admins pay", async () => {
    const owner = await signUp(app);
    const team = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(owner))
      .send({ name: "Club" });
    const email = uniqueEmail();
    await request(app)
      .post(`/workspaces/${team.body.id}/invitations`)
      .set("Authorization", bearer(owner))
      .send({ email });
    const token = /\/invite\/([\w-]+)/.exec(testOutbox.latest(email)!.text)![1]!;
    const member = await signUp(app, { email });
    await request(app).post(`/invitations/${token}/accept`).set("Authorization", bearer(member));
    const res = await request(app)
      .post(`/workspaces/${team.body.id}/billing/checkout`)
      .set("Authorization", bearer(member))
      .send({ plan: "team", provider: "stripe" });
    expect(res.status).toBe(403);
  });
});
