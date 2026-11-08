import { createLogger } from "@tessel/logger";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { CostCapExceededError } from "./errors";
import { createModelRegistry, loadModelRegistry } from "./registry";
import { createSpendGuard, memorySpendStore, redisSpendStore, type SpendStore } from "./spend";
import { costNanoUsd } from "./usage";

const logger = createLogger("spend-test", { level: "silent", pretty: false });
const subject = { userId: "user-1", workspaceId: "workspace-1" };
const limits = { userDailyUsd: 1, workspaceDailyUsd: 2, globalDailyUsd: 3 };
const USD = 1e9;

describe("spend guard", () => {
  it("allows calls until a cap is reached, then names the scope", async () => {
    const guard = createSpendGuard({ store: memorySpendStore(), limits, logger });
    await guard.assertWithinBudget(subject);
    await guard.add(subject, 0.6 * USD);
    await guard.assertWithinBudget(subject);
    await guard.add(subject, 0.4 * USD);

    const error = await guard.assertWithinBudget(subject).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CostCapExceededError);
    expect(error).toMatchObject({ scope: "user", status: 429, code: "daily_cost_cap_reached" });
    // Another user in the same workspace can still work.
    await guard.assertWithinBudget({ ...subject, userId: "user-2" });
  });

  it("caps the workspace and the whole service across users", async () => {
    const guard = createSpendGuard({ store: memorySpendStore(), limits, logger });
    await guard.add({ ...subject, userId: "a" }, 0.9 * USD);
    await guard.add({ ...subject, userId: "b" }, 0.9 * USD);
    await guard.add({ ...subject, userId: "c" }, 0.2 * USD);
    await expect(guard.assertWithinBudget({ ...subject, userId: "d" })).rejects.toMatchObject({
      scope: "workspace",
    });

    await guard.add({ userId: "e", workspaceId: "other" }, 1 * USD);
    await expect(
      guard.assertWithinBudget({ userId: "f", workspaceId: "third" }),
    ).rejects.toMatchObject({
      scope: "global",
    });
  });

  it("treats a cap of 0 as no cap", async () => {
    const guard = createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 0, workspaceDailyUsd: 0, globalDailyUsd: 0 },
      logger,
    });
    await guard.add(subject, 1_000 * USD);
    await guard.assertWithinBudget(subject);
  });

  it("starts again at midnight UTC", async () => {
    let now = new Date("2026-11-08T23:59:00Z");
    const guard = createSpendGuard({ store: memorySpendStore(), limits, logger, now: () => now });
    await guard.add(subject, 5 * USD);
    const error = (await guard
      .assertWithinBudget(subject)
      .catch((e: unknown) => e)) as CostCapExceededError;
    expect(error.resetsAt.toISOString()).toBe("2026-11-09T00:00:00.000Z");

    now = new Date("2026-11-09T00:00:01Z");
    await guard.assertWithinBudget(subject);
  });

  it("reads the ledger when the counters are unavailable", async () => {
    const broken: SpendStore = {
      get: () => Promise.reject(new Error("Redis is down")),
      add: () => Promise.reject(new Error("Redis is down")),
    };
    const since: Date[] = [];
    const guard = createSpendGuard({
      store: broken,
      limits,
      logger,
      now: () => new Date("2026-11-08T12:00:00Z"),
      ledgerFallback: async (_subject, from) => {
        since.push(from);
        return { user: 2 * USD, workspace: 0 };
      },
    });
    await expect(guard.assertWithinBudget(subject)).rejects.toMatchObject({ scope: "user" });
    expect(since[0]?.toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });
});

describe.skipIf(!process.env.TEST_REDIS_URL)("redis spend store", () => {
  const redis = new Redis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
  });
  afterAll(() => redis.quit());

  it("adds to every key and expires them", async () => {
    const store = redisSpendStore(redis);
    const prefix = `test:spend:${Date.now()}`;
    const keys = [`${prefix}:a`, `${prefix}:b`];
    await store.add(keys, 250, 60);
    await store.add(keys, 750, 60);
    expect(await store.get([...keys, `${prefix}:missing`])).toEqual([1000, 1000, 0]);
    expect(await redis.ttl(keys[0]!)).toBeGreaterThan(0);
    await redis.del(...keys);
  });
});

describe("model registry", () => {
  const registry = loadModelRegistry();

  it("loads the bundled models and their defaults", () => {
    expect(registry.forRole("chat").id).toBe("anthropic/claude-sonnet-5");
    expect(registry.forRole("embedding").kind).toBe("embedding");
    const picker = registry.list({ kind: "chat", selectable: true });
    expect(picker.length).toBeGreaterThan(3);
    expect(picker.every((model) => model.enabled && model.selectable)).toBe(true);
    expect(picker.map((model) => model.id)).not.toContain("openai/gpt-5.4-nano");
  });

  it("rejects invalid configuration", () => {
    const model = {
      id: "acme/one",
      label: "One",
      provider: "acme",
      kind: "chat",
      contextWindow: 1000,
      pricing: { input: 1, output: 1 },
    };
    const defaults = {
      chat: "acme/one",
      utility: "acme/one",
      moderation: "acme/one",
      embedding: "acme/one",
    };
    expect(() => createModelRegistry({ defaults, models: [model] })).toThrow(
      /enabled embedding model/,
    );
    expect(() =>
      createModelRegistry({
        defaults: { ...defaults, embedding: "acme/one" },
        models: [model, model],
      }),
    ).toThrow(/Duplicate ID/);
  });

  it("prices calls from the registry, with cheaper cached input", () => {
    const sonnet = registry.get("anthropic/claude-sonnet-5");
    expect(
      costNanoUsd(sonnet, {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      }),
    ).toBe(3 * USD);
    // 800k fresh at $3 + 200k cached at $0.30 + 100k output at $15.
    expect(
      costNanoUsd(sonnet, {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cachedInputTokens: 200_000,
        reasoningTokens: 0,
      }),
    ).toBe(2.4 * USD + 0.06 * USD + 1.5 * USD);
  });
});
