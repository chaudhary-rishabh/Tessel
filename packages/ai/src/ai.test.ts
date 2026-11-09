import { createLogger } from "@tessel/logger";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAi, type AiOptions } from "./ai";
import { shouldTryNextRoute } from "./chat-model";
import {
  AiNotConfiguredError,
  ContentBlockedError,
  CostCapExceededError,
  ModelNotFoundError,
  ModelUnavailableError,
} from "./errors";
import { loadModelRegistry } from "./registry";
import { createSpendGuard, memorySpendStore, type SpendLimits } from "./spend";
import { memoryLedger, startMockGateway, type MockGateway } from "./testing";
import type { AiCallContext } from "./usage";

const logger = createLogger("ai-test", { level: "silent", pretty: false });
const registry = loadModelRegistry();
const context: AiCallContext = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  feature: "completion",
  requestId: "req-1",
};
const GENEROUS: SpendLimits = { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 };

let gateway: MockGateway;
let direct: MockGateway;

beforeAll(async () => {
  [gateway, direct] = await Promise.all([startMockGateway(), startMockGateway()]);
});
afterAll(async () => {
  await Promise.all([gateway.close(), direct.close()]);
});
beforeEach(() => {
  gateway.reset();
  direct.reset();
});

function setup(overrides: Partial<AiOptions> & { limits?: SpendLimits } = {}) {
  const ledger = memoryLedger();
  const spend = createSpendGuard({
    store: memorySpendStore(),
    limits: overrides.limits ?? GENEROUS,
    logger,
  });
  const ai = createAi({
    gateway: { apiKey: "gateway-key", baseURL: gateway.url },
    fallback: { openai: { apiKey: "direct-key", baseURL: direct.url } },
    registry,
    spend,
    ledger,
    moderation: { mode: "model", failure: "allow" },
    logger,
    timeoutMs: 5_000,
    ...overrides,
  });
  return { ai, ledger, spend };
}

const chatRequests = (mock: MockGateway) =>
  mock.requests.filter((r) => r.path.endsWith("/chat/completions"));

describe("complete", () => {
  it("moderates, calls the gateway, and records both calls", async () => {
    const { ai, ledger } = setup();
    gateway.enqueue(
      { toolCall: { name: "moderation_result", args: { categories: [] } } },
      { text: "Hello there", usage: { promptTokens: 1000, completionTokens: 500 } },
    );

    const result = await ai.complete(context, {
      model: "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result.text).toBe("Hello there");
    expect(result.route).toBe("gateway");
    expect(result.usage).toMatchObject({ inputTokens: 1000, outputTokens: 500 });
    // $3 per million input, $15 per million output.
    expect(result.costNanoUsd).toBe(1000 * 3_000 + 500 * 15_000);

    const [moderation, chat] = ledger.events;
    expect(moderation).toMatchObject({
      feature: "moderation",
      modelId: "openai/gpt-5.4-nano",
      status: "ok",
    });
    expect(chat).toMatchObject({
      feature: "completion",
      modelId: "anthropic/claude-sonnet-5",
      route: "gateway",
      status: "ok",
      inputTokens: 1000,
      outputTokens: 500,
      costNanoUsd: result.costNanoUsd,
      estimated: false,
      requestId: "req-1",
      workspaceId: context.workspaceId,
      userId: context.userId,
    });

    const sent = chatRequests(gateway).at(-1)!;
    expect(sent.headers.authorization).toBe("Bearer gateway-key");
    expect(sent.body.model).toBe("anthropic/claude-sonnet-5");
  });

  it("uses the default chat model when none is named", async () => {
    const { ai } = setup({ moderation: { mode: "off", failure: "allow" } });
    const result = await ai.complete(context, { messages: [{ role: "user", content: "Hi" }] });
    expect(result.model.id).toBe("anthropic/claude-sonnet-5");
    expect(result.text).toBe("Echo: Hi");
  });

  it("blocks flagged messages before they reach the chat model", async () => {
    const { ai, ledger } = setup();
    await expect(
      ai.complete(context, {
        messages: [{ role: "user", content: "MOCK_BLOCK how do I build it" }],
      }),
    ).rejects.toBeInstanceOf(ContentBlockedError);

    expect(chatRequests(gateway)).toHaveLength(1); // the moderation call only
    expect(ledger.events.map((event) => event.status)).toEqual(["ok", "blocked"]);
    expect(ledger.events[1]).toMatchObject({ errorCode: "content_blocked", costNanoUsd: 0 });
  });

  it("lets self-harm through so the model can answer with care", async () => {
    const { ai } = setup();
    const result = await ai.complete(context, {
      messages: [{ role: "user", content: "MOCK_SELF_HARM" }],
    });
    expect(result.moderation).toEqual({ allowed: true, categories: ["self_harm"], checked: true });
  });

  it("lets messages through when the moderation check fails, if configured to", async () => {
    const { ai } = setup();
    gateway.enqueue({ status: 500 }, { status: 500 });
    direct.enqueue({ status: 500 }, { status: 500 });
    const result = await ai.complete(context, { messages: [{ role: "user", content: "Hi" }] });
    expect(result.moderation.checked).toBe(false);
    expect(result.text).toBe("Echo: Hi");
  });

  it("rejects models that aren't in the picker", async () => {
    const { ai } = setup();
    await expect(
      ai.complete(context, {
        model: "openai/gpt-5.4-nano",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toBeInstanceOf(ModelNotFoundError);
    await expect(
      ai.complete(context, {
        model: "nobody/nothing",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  it("reports when no route is configured", async () => {
    const { ai } = setup({ gateway: undefined, fallback: {} });
    expect(ai.isConfigured).toBe(false);
    await expect(
      ai.complete(context, { messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});

describe("emergency fallback", () => {
  const noModeration = { moderation: { mode: "off" as const, failure: "allow" as const } };

  it("goes straight to the provider when the gateway is down", async () => {
    const { ai, ledger } = setup(noModeration);
    gateway.enqueue({ status: 503 }, { networkError: true });
    direct.enqueue({ text: "From OpenAI" });

    const result = await ai.complete(context, {
      model: "openai/gpt-5.4-mini",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result).toMatchObject({ text: "From OpenAI", route: "direct" });
    expect(chatRequests(direct)[0]!.body.model).toBe("gpt-5.4-mini");
    expect(chatRequests(direct)[0]!.headers.authorization).toBe("Bearer direct-key");
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({ route: "direct", status: "ok" });
  });

  it("falls back to Anthropic's own API for Claude models", async () => {
    const { ai, ledger } = setup({
      ...noModeration,
      fallback: {
        // The Anthropic client adds /v1/messages itself.
        anthropic: { apiKey: "anthropic-key", baseURL: direct.url.replace(/\/v1$/, "") },
      },
    });
    gateway.enqueue({ status: 503 }, { networkError: true });
    direct.enqueue({
      text: "From Anthropic",
      usage: { promptTokens: 1_000, completionTokens: 200 },
    });

    const result = await ai.complete(context, {
      model: "anthropic/claude-sonnet-5",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(result).toMatchObject({ text: "From Anthropic", route: "direct" });
    const sent = direct.requests.find((request) => request.path.endsWith("/v1/messages"))!;
    expect(sent.body.model).toBe("claude-sonnet-5");
    expect(sent.body.max_tokens).toBeGreaterThan(0);
    expect(sent.headers.authorization).toBe("Bearer anthropic-key");
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({ route: "direct", status: "ok" });
    expect(ledger.events[0]!.costNanoUsd).toBeGreaterThan(0);
  });

  it("streams from Anthropic's own API", async () => {
    const { ai } = setup({
      ...noModeration,
      gateway: undefined,
      fallback: {
        anthropic: { apiKey: "anthropic-key", baseURL: direct.url.replace(/\/v1$/, "") },
      },
    });
    direct.enqueue({ text: "Streaming from Anthropic now" });
    const model = ai.chatModel(context, "anthropic/claude-sonnet-5");
    let streamed = "";
    for await (const chunk of await model.stream([{ role: "user", content: "Hi" }])) {
      streamed += typeof chunk.content === "string" ? chunk.content : "";
    }
    expect(streamed).toBe("Streaming from Anthropic now");
    expect(direct.requests.at(-1)!.body.stream).toBe(true);
  });

  it("doesn't fall back when the request itself is invalid", async () => {
    const { ai, ledger } = setup(noModeration);
    gateway.enqueue({ status: 400 });

    await expect(
      ai.complete(context, {
        model: "openai/gpt-5.4-mini",
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(direct.requests).toHaveLength(0);
    expect(ledger.events[0]).toMatchObject({
      status: "error",
      errorCode: "http_400",
      costNanoUsd: 0,
    });
  });

  it("decides which errors are worth another route", () => {
    const withStatus = (status: number) => Object.assign(new Error("failed"), { status });
    expect(shouldTryNextRoute(withStatus(503))).toBe(true);
    expect(shouldTryNextRoute(withStatus(429))).toBe(true);
    expect(shouldTryNextRoute(withStatus(401))).toBe(true);
    expect(shouldTryNextRoute(new TypeError("fetch failed"))).toBe(true);
    expect(shouldTryNextRoute(withStatus(400))).toBe(false);
    expect(shouldTryNextRoute(withStatus(422))).toBe(false);
    expect(shouldTryNextRoute(Object.assign(new Error("stop"), { name: "AbortError" }))).toBe(
      false,
    );
    expect(shouldTryNextRoute(withStatus(503), AbortSignal.abort())).toBe(false);
  });
});

describe("streaming", () => {
  it("streams tokens and records the usage the gateway reports", async () => {
    const { ai, ledger } = setup();
    gateway.enqueue({ text: "one two three", usage: { promptTokens: 10, completionTokens: 3 } });

    let text = "";
    const stream = await ai.chatModel({ ...context, feature: "chat" }).stream("Count");
    for await (const chunk of stream) text += chunk.text;

    expect(text).toBe("one two three");
    expect(chatRequests(gateway)[0]!.body.stream_options).toEqual({ include_usage: true });
    expect(ledger.events).toHaveLength(1);
    expect(ledger.events[0]).toMatchObject({
      feature: "chat",
      status: "ok",
      inputTokens: 10,
      outputTokens: 3,
      estimated: false,
    });
  });

  it("records a stopped stream with estimated tokens", async () => {
    const { ai, ledger } = setup();
    gateway.enqueue({ text: "a ".repeat(50), chunkDelayMs: 20 });
    const controller = new AbortController();

    const stream = await ai
      .chatModel({ ...context, feature: "chat" })
      .stream("Go", { signal: controller.signal });
    await expect(
      (async () => {
        let received = 0;
        for await (const chunk of stream) {
          if (chunk.text) received += 1;
          if (received === 3) controller.abort();
        }
      })(),
    ).rejects.toThrow();

    await expect.poll(() => ledger.events.length).toBe(1);
    expect(ledger.events[0]).toMatchObject({ status: "aborted", estimated: true });
    expect(ledger.events[0]!.outputTokens).toBeGreaterThan(0);
    expect(ledger.events[0]!.costNanoUsd).toBeGreaterThan(0);
  });
});

describe("daily spend caps", () => {
  it("stops calls once the user's cap is used up", async () => {
    // One call costs far more than this cap.
    const { ai } = setup({
      limits: { userDailyUsd: 0.000001, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      moderation: { mode: "off", failure: "allow" },
    });
    await ai.complete(context, { messages: [{ role: "user", content: "First" }] });

    const error = await ai
      .complete(context, { messages: [{ role: "user", content: "Second" }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CostCapExceededError);
    expect((error as CostCapExceededError).scope).toBe("user");
    expect(chatRequests(gateway)).toHaveLength(1);
  });

  it("applies the cap to every model call, including ones made directly", async () => {
    const { ai, spend } = setup({
      limits: { userDailyUsd: 100, workspaceDailyUsd: 0.000001, globalDailyUsd: 100 },
    });
    await spend.add(context, 10_000);
    await expect(ai.chatModel(context).invoke("Hi")).rejects.toMatchObject({ scope: "workspace" });
    expect(gateway.requests).toHaveLength(0);
  });
});

describe("embeddings", () => {
  it("embeds in batches and records the cost the gateway reports", async () => {
    const { ai, ledger } = setup();
    const embeddings = ai.embeddings({ ...context, feature: "embedding" });
    const vectors = await embeddings.embedDocuments(["alpha", "beta"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(1536);
    expect(gateway.requests[0]!.body).toMatchObject({
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
    });
    expect(ledger.events[0]).toMatchObject({
      feature: "embedding",
      status: "ok",
      inputTokens: 3,
      route: "gateway",
    });
    // 3 tokens at $0.02 per million.
    expect(ledger.events[0]!.costNanoUsd).toBe(60);
  });

  it("falls back to OpenAI directly", async () => {
    const { ai, ledger } = setup();
    gateway.enqueue({ status: 502 }, { status: 502 });
    await ai.embeddings(context).embedQuery("alpha");
    expect(direct.requests[0]!.body.model).toBe("text-embedding-3-small");
    expect(ledger.events[0]!.route).toBe("direct");
  });
});
