import { memoryKeyValueCache, memoryVectorIndex, sparseVector, withSearchCache } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { agentRuns, documents, messages, refreshTokens, runMaintenance } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp } from "./helpers";

let gateway: MockGateway;
let app: Express;
const cache = memoryKeyValueCache();
const base = memoryVectorIndex();
let indexSearches = 0;
const index = withSearchCache(
  { ...base, search: (query) => ((indexSearches += 1), base.search(query)) },
  cache,
);

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({
      gatewayUrl: gateway.url,
      moderation: { mode: "off", failure: "allow" },
      cache,
    }),
    vectorIndex: index,
  });
});
afterAll(() => gateway.close());
beforeEach(() => {
  gateway.reset();
  indexSearches = 0;
});

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;
const embeddingCalls = () => gateway.requests.filter((r) => r.path.endsWith("/embeddings")).length;

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, path: `/workspaces/${workspaceId}` };
}

const chunk = (workspaceId: string, documentId: string, text: string) => ({
  payload: {
    workspace_id: workspaceId,
    document_id: documentId,
    chunk_index: 0,
    text,
    filename: "policy.md",
  },
  dense: new Array(1536).fill(0.01),
  sparse: sparseVector(text),
});

describe("caching", () => {
  it("answers repeat searches from the cache, and re-indexing clears it", async () => {
    const { user, workspaceId, path } = await setup();
    const [document] = await ownerDb()
      .insert(documents)
      .values({
        workspaceId,
        userId: user.auth.user.id,
        filename: "policy.md",
        mediaType: "text/markdown",
        sizeBytes: 10,
        storageKey: "k",
        status: "ready",
      })
      .returning();
    await index.upsert([chunk(workspaceId, document!.id, "The quokka allowance is 40 euros.")]);

    const search = () =>
      request(app)
        .post(`${path}/search`)
        .set("Authorization", bearer(user))
        .send({ query: "quokka allowance" });
    expect((await search()).body.hits[0].text).toBe("The quokka allowance is 40 euros.");
    expect((await search()).body.hits[0].text).toBe("The quokka allowance is 40 euros.");
    expect(embeddingCalls()).toBe(1);
    expect(indexSearches).toBe(1);

    // Re-indexing the document (as the worker does) makes the next search fresh.
    await index.upsert([chunk(workspaceId, document!.id, "The quokka allowance is 55 euros.")]);
    expect((await search()).body.hits[0].text).toBe("The quokka allowance is 55 euros.");
    expect(indexSearches).toBe(2);
    expect(embeddingCalls()).toBe(1);

    // Deleting a document clears it too.
    await request(app)
      .delete(`${path}/documents/${document!.id}`)
      .set("Authorization", bearer(user));
    expect((await search()).body.hits).toEqual([]);
    expect(indexSearches).toBe(3);
  });

  it("lets browsers reuse the model list", async () => {
    const { user } = await setup();
    const first = await request(app).get("/models").set("Authorization", bearer(user));
    expect(first.headers["cache-control"]).toBe("private, max-age=300");
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const again = await request(app)
      .get("/models")
      .set("Authorization", bearer(user))
      .set("If-None-Match", etag);
    expect(again.status).toBe(304);
  });
});

describe("maintenance", () => {
  it("deletes old refresh tokens and closes approvals nobody answered", async () => {
    const { user, path } = await setup();
    const userId = user.auth.user.id;
    const day = 86_400_000;
    await ownerDb()
      .insert(refreshTokens)
      .values([
        {
          userId,
          familyId: crypto.randomUUID(),
          tokenHash: `old-${userId}`,
          expiresAt: new Date(Date.now() - 2 * day),
        },
        {
          userId,
          familyId: crypto.randomUUID(),
          tokenHash: `revoked-${userId}`,
          expiresAt: new Date(Date.now() + day),
          revokedAt: new Date(Date.now() - 8 * day),
        },
      ]);

    const res = await request(app)
      .post(`${path}/chat`)
      .set("Authorization", bearer(user))
      .send({
        knowledge: "off",
        content: `MOCK_TOOLS ${JSON.stringify([{ name: "create_document", args: { filename: "x.md", content: "x" } }])}`,
      })
      .buffer(true)
      .parse((response, callback) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (piece: string) => (text += piece));
        response.on("end", () => callback(null, text));
      });
    const done = (res.body as string)
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(6)) as ChatEvent)
      .find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("No reply");
    await ownerDb()
      .update(agentRuns)
      .set({ updatedAt: new Date(Date.now() - 8 * day) })
      .where(eq(agentRuns.messageId, done.message.id));

    // As the worker runs it: the app role, through the maintenance function.
    const report = await runMaintenance(connect().db);
    expect(report.refreshTokensDeleted).toBeGreaterThanOrEqual(2);
    expect(report.waitingRunsExpired).toBeGreaterThanOrEqual(1);

    const remaining = await ownerDb()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    expect(remaining.map((row) => row.tokenHash)).not.toContain(`old-${userId}`);
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    const [message] = await ownerDb()
      .select()
      .from(messages)
      .where(eq(messages.id, done.message.id));
    expect(message).toMatchObject({ status: "complete", toolCalls: [{ status: "cancelled" }] });
    const [run] = await ownerDb()
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.messageId, done.message.id));
    expect(run!.status).toBe("cancelled");
  });
});
