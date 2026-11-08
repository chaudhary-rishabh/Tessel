import { createLogger } from "@tessel/logger";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAi } from "./ai";
import { memoryKeyValueCache, packVector, redisKeyValueCache, unpackVector } from "./cache";
import { memoryVectorIndex, sparseVector, withSearchCache } from "./rag/index";
import { loadModelRegistry } from "./registry";
import { createSpendGuard, memorySpendStore } from "./spend";
import { memoryLedger, startMockGateway, type MockGateway } from "./testing";

const logger = createLogger("cache-test", { level: "silent", pretty: false });
const context = { workspaceId: "w1", userId: "u1", feature: "search" as const };

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const embeddingCalls = () => gateway.requests.filter((r) => r.path.endsWith("/embeddings"));

function setup() {
  const cache = memoryKeyValueCache();
  const ledger = memoryLedger();
  const ai = createAi({
    gateway: { apiKey: "k", baseURL: gateway.url },
    registry: loadModelRegistry(),
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger,
    }),
    ledger,
    moderation: { mode: "off", failure: "allow" },
    logger,
    cache,
  });
  return { ai, cache, ledger };
}

describe("caching", () => {
  it("packs vectors compactly without losing float32 precision", () => {
    const vector = [0.125, -0.5, 0.333333];
    const packed = packVector(vector);
    expect(packed.length).toBeLessThan(JSON.stringify(vector).length + 4);
    expect(unpackVector(packed)).toEqual(Array.from(new Float32Array(vector)));
  });

  it("reuses embeddings of text it has seen, and only embeds the rest", async () => {
    const { ai, ledger } = setup();
    const first = await ai.embeddings(context).embedDocuments(["alpha", "beta"]);
    expect(embeddingCalls()).toHaveLength(1);
    const again = await ai.embeddings(context).embedQuery("alpha");
    expect(embeddingCalls()).toHaveLength(1);
    expect(again).toEqual(Array.from(new Float32Array(first[0]!)));

    const mixed = await ai.embeddings(context).embedDocuments(["beta", "gamma"]);
    expect(embeddingCalls()).toHaveLength(2);
    expect(embeddingCalls()[1]!.body.input).toEqual(["gamma"]);
    expect(mixed).toHaveLength(2);
    expect(ai.embeddingCacheStats).toEqual({ hits: 2, misses: 3 });
    // Only real calls cost anything.
    expect(ledger.events).toHaveLength(2);
  });

  it("serves repeat searches from the cache until the workspace's index changes", async () => {
    const { cache } = setup();
    const base = memoryVectorIndex();
    let searches = 0;
    const counted = {
      ...base,
      search: (...args: Parameters<typeof base.search>) => ((searches += 1), base.search(...args)),
    };
    const index = withSearchCache(counted, cache);
    const chunk = (workspace: string, text: string, document = "d1") => ({
      payload: {
        workspace_id: workspace,
        document_id: document,
        chunk_index: 0,
        text,
        filename: "a.md",
      },
      dense: [1, 0],
      sparse: sparseVector(text),
    });
    const query = { workspaceId: "w1", dense: [1, 0], sparse: sparseVector("budget"), limit: 5 };

    await index.upsert([chunk("w1", "budget is 40"), chunk("w2", "budget is 99", "d9")]);
    expect((await index.search(query))[0]!.payload.text).toBe("budget is 40");
    expect((await index.search(query))[0]!.payload.text).toBe("budget is 40");
    expect(searches).toBe(1);
    expect(index.stats).toEqual({ hits: 1, misses: 1 });

    // Another workspace changing doesn't clear this one.
    await index.upsert([chunk("w2", "budget is 100", "d2")]);
    await index.search(query);
    expect(searches).toBe(1);

    // Re-indexing this workspace does.
    await index.upsert([chunk("w1", "budget is 50")]);
    expect((await index.search(query))[0]!.payload.text).toBe("budget is 50");
    expect(searches).toBe(2);
    await index.deleteDocument("w1", "d1");
    expect(await index.search(query)).toEqual([]);
    expect(searches).toBe(3);
  });

  it("asks the gateway to cache prompts, and keeps a chat on one provider", async () => {
    const { ai } = setup();
    await ai
      .chatModel({ ...context, feature: "chat" }, undefined, { sessionId: "thread-1" })
      .invoke("Hi");
    const call = gateway.requests.find((r) => r.path.endsWith("/chat/completions"))!;
    expect(call.body.providerOptions).toEqual({ gateway: { caching: "auto" } });
    expect(call.headers["x-session-affinity"]).toBe("thread-1");
  });

  it("fails open when Redis is down", async () => {
    const broken = {
      get: () => Promise.reject(new Error("down")),
      mget: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
      incr: () => Promise.reject(new Error("down")),
    };
    const cache = redisKeyValueCache(broken as never);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.mget(["a", "b"])).toEqual([null, null]);
    await expect(cache.set("a", "b", 10)).resolves.toBeUndefined();
    expect(await cache.incr("a")).toBeNull();
  });
});
