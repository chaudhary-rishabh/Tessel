import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { billingSummarySchema, PLANS } from "@tessel/contracts";
import { billingAccounts, extraUsageRequests, usageEvents, usageWindows } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  signUp,
  uniqueEmail,
  type SignedUpUser,
} from "./helpers";

let gateway: MockGateway;
let app: Express;
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({ ai: createTestAi({ gatewayUrl: gateway.url }) });
});
afterAll(() => gateway.close());

async function setup() {
  const user = await signUp(app);
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = res.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

function complete(user: SignedUpUser, base: string, model?: string) {
  return request(app)
    .post(`${base}/completions`)
    .set("Authorization", bearer(user))
    .send({ messages: [{ role: "user", content: "Hello" }], ...(model ? { model } : {}) });
}

/** Spends model cost as if earlier messages had used it. */
async function spend(user: SignedUpUser, workspaceId: string, nanoUsd: number) {
  await ownerDb().insert(usageEvents).values({
    workspaceId,
    userId: user.auth.user.id,
    feature: "chat",
    modelId: "openai/gpt-5.4-mini",
    route: "gateway",
    status: "ok",
    costNanoUsd: nanoUsd,
  });
}

async function setPlan(
  workspaceId: string,
  plan: "free" | "pro" | "max" | "team",
  extra?: { capUsd: number },
) {
  await ownerDb()
    .insert(billingAccounts)
    .values({
      workspaceId,
      plan,
      extraUsageEnabled: Boolean(extra),
      extraUsageCapNanoUsd: (extra?.capUsd ?? 0) * 1e9,
    })
    .onConflictDoUpdate({
      target: billingAccounts.workspaceId,
      set: {
        plan,
        extraUsageEnabled: Boolean(extra),
        extraUsageCapNanoUsd: (extra?.capUsd ?? 0) * 1e9,
      },
    });
}

describe("plan limits", () => {
  it("starts on the free plan with a five-hour and a weekly window", async () => {
    const { user, base } = await setup();
    const before = billingSummarySchema.parse(
      (await request(app).get(`${base}/billing`).set("Authorization", bearer(user))).body,
    );
    expect(before).toMatchObject({
      plan: "free",
      canManage: true,
      usage: { session: { used: 0, resetsAt: null }, week: { used: 0, resetsAt: null } },
      extraUsage: { available: false, enabled: false },
    });

    expect((await complete(user, base)).status).toBe(200);
    const after = (await request(app).get(`${base}/billing`).set("Authorization", bearer(user)))
      .body;
    const session = new Date(after.usage.session.resetsAt).getTime() - Date.now();
    const week = new Date(after.usage.week.resetsAt).getTime() - Date.now();
    expect(session).toBeGreaterThan(4.9 * 3600_000);
    expect(session).toBeLessThanOrEqual(5 * 3600_000);
    expect(week).toBeGreaterThan(6.9 * 86_400_000);
    expect(after.usage.session.used).toBeGreaterThan(0);
  });

  it("refuses requests past the five-hour limit until it resets", async () => {
    const { user, workspaceId, base } = await setup();
    expect((await complete(user, base)).status).toBe(200);
    await spend(user, workspaceId, PLANS.free.limits.sessionNanoUsd);

    const refused = await complete(user, base);
    expect(refused.status).toBe(429);
    expect(refused.body.error).toMatchObject({
      code: "usage_limit_reached",
      details: { window: "session", resetsAt: expect.any(String) },
    });
    expect(refused.body.error.message).toContain("five-hour usage limit");

    // Once the window has passed, a new one starts.
    await ownerDb()
      .update(usageWindows)
      .set({
        startedAt: new Date(Date.now() - 6 * 3600_000),
        resetsAt: new Date(Date.now() - 3600_000),
      })
      .where(eq(usageWindows.kind, "session"));
    await ownerDb().delete(usageEvents).where(eq(usageEvents.workspaceId, workspaceId));
    expect((await complete(user, base)).status).toBe(200);
  });

  it("applies the weekly limit too", async () => {
    const { user, workspaceId, base } = await setup();
    await setPlan(workspaceId, "pro");
    expect((await complete(user, base)).status).toBe(200);
    await spend(user, workspaceId, PLANS.pro.limits.weekNanoUsd);
    const refused = await complete(user, base);
    expect(refused.body.error.details.window).toBe("week");
    expect(refused.body.error.message).toContain("Turn on extra usage");
  });

  it("keeps the most capable models for paid plans", async () => {
    const { user, workspaceId, base } = await setup();
    const opus = await complete(user, base, "anthropic/claude-opus-5");
    expect(opus.status).toBe(403);
    expect(opus.body.error.code).toBe("model_requires_plan");
    await setPlan(workspaceId, "pro");
    expect((await complete(user, base, "anthropic/claude-opus-5")).status).toBe(200);
  });

  it("counts limits per person in a team workspace", async () => {
    const { user, base } = await setup();
    const team = await request(app)
      .post("/workspaces")
      .set("Authorization", bearer(user))
      .send({ name: "Team" });
    const teamBase = `/workspaces/${team.body.id}`;
    expect((await complete(user, teamBase)).status).toBe(200);
    await spend(user, team.body.id, PLANS.free.limits.weekNanoUsd);
    expect((await complete(user, teamBase)).status).toBe(429);
    // The personal workspace has its own limits.
    expect((await complete(user, base)).status).toBe(200);
  });
});

describe("extra usage", () => {
  it("lets paid plans keep going past a limit, up to the monthly cap", async () => {
    const { user, workspaceId, base } = await setup();
    await setPlan(workspaceId, "pro");
    const turnOn = await request(app)
      .put(`${base}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 0.000001 });
    expect(turnOn.status).toBe(200);
    expect(turnOn.body.extraUsage).toMatchObject({ enabled: true, capNanoUsd: 1000 });

    expect((await complete(user, base)).status).toBe(200);
    await spend(user, workspaceId, PLANS.pro.limits.sessionNanoUsd);
    const extra = await complete(user, base);
    expect(extra.status).toBe(200);
    const recorded = await ownerDb()
      .select()
      .from(extraUsageRequests)
      .where(eq(extraUsageRequests.workspaceId, workspaceId));
    expect(recorded).toHaveLength(1);

    // That request cost more than the tiny cap, so the next is refused.
    const summary = (await request(app).get(`${base}/billing`).set("Authorization", bearer(user)))
      .body;
    expect(summary.extraUsage.spentNanoUsd).toBeGreaterThan(1000);
    expect((await complete(user, base)).status).toBe(429);
  });

  it("isn't available on the free plan, and only owners and admins change it", async () => {
    const { user, base, workspaceId } = await setup();
    const free = await request(app)
      .put(`${base}/billing/extra-usage`)
      .set("Authorization", bearer(user))
      .send({ enabled: true, capUsd: 10 });
    expect(free.body.error.code).toBe("plan_has_no_extra_usage");

    await setPlan(workspaceId, "pro");
    const stranger = await signUp(app, { email: uniqueEmail() });
    const other = await request(app)
      .put(`${base}/billing/extra-usage`)
      .set("Authorization", bearer(stranger))
      .send({ enabled: true, capUsd: 10 });
    expect(other.status).toBe(404);
  });
});
