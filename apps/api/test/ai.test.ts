import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { createUsageLedger, usageEvents, withUserContext, workspaceMembers } from "@tessel/db";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

async function personalWorkspaceId(
  app: Parameters<typeof request>[0],
  user: SignedUpUser,
): Promise<string> {
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  return res.body.workspaces[0].id;
}

/** Ledger rows, read as the database owner so row-level security doesn't hide any. */
function ledgerRows(userId: string) {
  return ownerDb()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .orderBy(usageEvents.createdAt);
}

/** The Postgres message behind a failed Drizzle query. */
async function databaseError(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e as Error & { cause?: Error },
  );
  if (!error) throw new Error("Expected the query to fail");
  return error.cause?.message ?? error.message;
}

const ask = (content: string) => ({ messages: [{ role: "user", content }] });

describe("models", () => {
  const app = createTestApp({ ai: createTestAi({ gatewayUrl: "http://127.0.0.1:9/v1" }) });

  it("lists the models a user can pick, without prices", async () => {
    const user = await signUp(app);
    const res = await request(app).get("/models").set("Authorization", bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.defaultModel).toBe("anthropic/claude-sonnet-5.5");
    const ids = res.body.models.map((model: { id: string }) => model.id);
    expect(ids).toContain("anthropic/claude-sonnet-5.5");
    expect(ids).toContain("deepseek/deepseek-v4-flash");
    expect(ids).not.toContain("openai/text-embedding-3-small");
    expect(res.body.models[0]).not.toHaveProperty("pricing");
    expect(res.body.models[0]).not.toHaveProperty("fallback");
  });

  it("requires a signed-in user", async () => {
    expect((await request(app).get("/models")).status).toBe(401);
  });
});

describe("completions", () => {
  const app = createTestApp({ ai: createTestAi({ gatewayUrl: "" }) });
  // Built lazily: the mock gateway's URL is only known once it has started.
  let aiApp: ReturnType<typeof createTestApp>;
  beforeAll(() => {
    aiApp = createTestApp({ ai: createTestAi({ gatewayUrl: gateway.url }) });
  });

  it("answers, and records the chat and moderation calls in the ledger", async () => {
    const user = await signUp(aiApp);
    const workspaceId = await personalWorkspaceId(aiApp, user);
    gateway.enqueue(
      { toolCall: { name: "moderation_result", args: { categories: [] } } },
      { text: "Paris.", usage: { promptTokens: 2000, completionTokens: 1000 } },
    );

    const res = await request(aiApp)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(user))
      .send({ model: "openai/gpt-5.4-mini", ...ask("Capital of France?") });

    expect(res.status).toBe(200);
    expect(res.body.message).toEqual({ role: "assistant", content: "Paris." });
    expect(res.body.model).toBe("openai/gpt-5.4-mini");
    // 2,000 in at $0.75/M + 1,000 out at $4.50/M.
    expect(res.body.usage).toEqual({ inputTokens: 2000, outputTokens: 1000, costUsd: 0.006 });

    const rows = await ledgerRows(user.auth.user.id);
    expect(rows.map((row) => [row.feature, row.modelId, row.status])).toEqual([
      ["moderation", "openai/gpt-5.4-nano", "ok"],
      ["completion", "openai/gpt-5.4-mini", "ok"],
    ]);
    expect(rows[1]).toMatchObject({
      workspaceId,
      route: "gateway",
      inputTokens: 2000,
      outputTokens: 1000,
      costNanoUsd: 6_000_000,
      requestId: res.headers["x-request-id"],
    });
  });

  it("hides workspaces the user doesn't belong to, without calling a model", async () => {
    const owner = await signUp(aiApp);
    const outsider = await signUp(aiApp);
    const workspaceId = await personalWorkspaceId(aiApp, owner);

    const res = await request(aiApp)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(outsider))
      .send(ask("Hi"));

    expect(res.status).toBe(404);
    expect(gateway.requests).toHaveLength(0);
  });

  it("blocks messages that break the usage policy", async () => {
    const user = await signUp(aiApp);
    const workspaceId = await personalWorkspaceId(aiApp, user);

    const res = await request(aiApp)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(user))
      .send(ask("MOCK_BLOCK"));

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: "content_blocked",
      details: { categories: ["weapons"] },
    });
    const rows = await ledgerRows(user.auth.user.id);
    expect(rows.map((row) => row.status)).toEqual(["ok", "blocked"]);
  });

  it("stops at the daily spend cap and says when it resets", async () => {
    const cappedApp = createTestApp({
      ai: createTestAi({
        gatewayUrl: gateway.url,
        limits: { userDailyUsd: 0.000001, workspaceDailyUsd: 100, globalDailyUsd: 100 },
        moderation: { mode: "off", failure: "allow" },
      }),
    });
    const user = await signUp(cappedApp);
    const workspaceId = await personalWorkspaceId(cappedApp, user);
    const send = () =>
      request(cappedApp)
        .post(`/workspaces/${workspaceId}/completions`)
        .set("Authorization", bearer(user))
        .send(ask("Hi"));

    expect((await send()).status).toBe(200);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: "daily_cost_cap_reached",
      details: { scope: "user" },
    });
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("validates the conversation", async () => {
    const user = await signUp(aiApp);
    const workspaceId = await personalWorkspaceId(aiApp, user);
    const res = await request(aiApp)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(user))
      .send({ messages: [{ role: "assistant", content: "I spoke last" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("rejects unknown models", async () => {
    const user = await signUp(aiApp);
    const workspaceId = await personalWorkspaceId(aiApp, user);
    const res = await request(aiApp)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(user))
      .send({ model: "nobody/nothing", ...ask("Hi") });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("model_not_found");
  });

  it("explains when AI is not configured", async () => {
    const user = await signUp(app);
    const workspaceId = await personalWorkspaceId(app, user);
    const res = await request(app)
      .post(`/workspaces/${workspaceId}/completions`)
      .set("Authorization", bearer(user))
      .send(ask("Hi"));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ai_not_configured");
  });
});

describe("usage", () => {
  let app: ReturnType<typeof createTestApp>;
  beforeAll(() => {
    app = createTestApp({
      ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    });
  });

  it("shows members their own usage and owners the whole workspace", async () => {
    const owner = await signUp(app);
    const member = await signUp(app);
    const workspaceId = await personalWorkspaceId(app, owner);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: member.auth.user.id, role: "member" });

    const complete = (user: SignedUpUser, promptTokens: number) => {
      gateway.enqueue({ text: "ok", usage: { promptTokens, completionTokens: 0 } });
      return request(app)
        .post(`/workspaces/${workspaceId}/completions`)
        .set("Authorization", bearer(user))
        .send({ model: "anthropic/claude-sonnet-5", ...ask("Hi") });
    };
    expect((await complete(owner, 1_000_000)).status).toBe(200); // $2
    expect((await complete(member, 500_000)).status).toBe(200); // $1

    const summary = (user: SignedUpUser) =>
      request(app)
        .get(`/workspaces/${workspaceId}/usage?days=7`)
        .set("Authorization", bearer(user));

    const ownerView = await summary(owner);
    expect(ownerView.status).toBe(200);
    expect(ownerView.body.scope).toBe("workspace");
    expect(ownerView.body.totals).toEqual({
      calls: 2,
      inputTokens: 1_500_000,
      outputTokens: 0,
      costUsd: 3,
    });
    expect(ownerView.body.byModel).toEqual([
      {
        modelId: "anthropic/claude-sonnet-5",
        label: "Claude Sonnet 5",
        calls: 2,
        inputTokens: 1_500_000,
        outputTokens: 0,
        costUsd: 3,
      },
    ]);
    expect(ownerView.body.byFeature[0]).toMatchObject({ feature: "completion", calls: 2 });
    expect(ownerView.body.byDay).toEqual([
      { day: new Date().toISOString().slice(0, 10), calls: 2, costUsd: 3 },
    ]);
    expect(ownerView.body.today).toMatchObject({
      user: { spentUsd: 2, limitUsd: 100 },
      workspace: { spentUsd: 3, limitUsd: 100 },
    });

    const memberView = await summary(member);
    expect(memberView.body.scope).toBe("user");
    expect(memberView.body.totals).toMatchObject({ calls: 1, costUsd: 1 });
  });

  it("hides other workspaces' usage", async () => {
    const owner = await signUp(app);
    const outsider = await signUp(app);
    const workspaceId = await personalWorkspaceId(app, owner);
    const res = await request(app)
      .get(`/workspaces/${workspaceId}/usage`)
      .set("Authorization", bearer(outsider));
    expect(res.status).toBe(404);
  });
});

describe("usage ledger in the database", () => {
  const app = createTestApp();

  it("is append-only and only accepts the acting user's usage", async () => {
    const user = await signUp(app);
    const other = await signUp(app);
    const workspaceId = await personalWorkspaceId(app, user);
    const db = connect().db;
    const ledger = createUsageLedger(db);
    const event = {
      workspaceId,
      userId: user.auth.user.id,
      requestId: null,
      feature: "completion",
      modelId: "openai/gpt-5.4-mini",
      route: "gateway" as const,
      status: "ok" as const,
      inputTokens: 10,
      outputTokens: 10,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      costNanoUsd: 52_500,
      estimated: false,
      latencyMs: 5,
      errorCode: null,
    };
    await ledger.record(event);

    // Recording usage for someone else, or in a workspace you don't belong to, fails.
    await expect(ledger.record({ ...event, userId: other.auth.user.id })).rejects.toThrow();
    expect(
      await databaseError(
        withUserContext(db, other.auth.user.id, (tx) =>
          tx.insert(usageEvents).values({ ...event, userId: other.auth.user.id }),
        ),
      ),
    ).toMatch(/row-level security/);

    // The app role can't edit or delete history.
    expect(
      await databaseError(
        withUserContext(db, user.auth.user.id, (tx) =>
          tx.update(usageEvents).set({ costNanoUsd: 0 }),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await databaseError(withUserContext(db, user.auth.user.id, (tx) => tx.delete(usageEvents))),
    ).toMatch(/permission denied/);

    const startOfDay = new Date(new Date().toISOString().slice(0, 10));
    expect(await ledger.spentSince({ userId: user.auth.user.id, workspaceId }, startOfDay)).toEqual(
      {
        user: 52_500,
        workspace: 52_500,
      },
    );
    // Outsiders can't read a workspace's spend.
    const outsiderTotal = await withUserContext(db, other.auth.user.id, (tx) =>
      tx.execute<{ total: string | null }>(
        sql`select app.workspace_spend_since(${workspaceId}::uuid, now() - interval '1 day') as total`,
      ),
    );
    expect(outsiderTotal.rows[0]?.total).toBeNull();
  });
});
