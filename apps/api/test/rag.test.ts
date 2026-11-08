import { memoryVectorIndex, sparseVector } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { documents, usageEvents } from "@tessel/db";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;
const index = memoryVectorIndex();

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    storage: { objects: memoryObjectStore(), uploads: memoryUploadQueue(), uploadEvents: "api" },
    vectorIndex: index,
  });
});
afterAll(() => gateway.close());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

/** A user whose workspace has one indexed document about the zephyrine allowance. */
async function userWithDocument(): Promise<{
  user: SignedUpUser;
  base: string;
  documentId: string;
}> {
  const user = await signUp(app);
  const workspaceId = (await request(app).get("/workspaces").set("Authorization", bearer(user)))
    .body.workspaces[0].id as string;
  const [row] = await ownerDb()
    .insert(documents)
    .values({
      workspaceId,
      userId: user.auth.user.id,
      filename: "travel-policy.pdf",
      mediaType: "application/pdf",
      sizeBytes: 10,
      storageKey: `workspaces/${workspaceId}/documents/x/original`,
      status: "ready",
    })
    .returning();
  await index.upsert([
    {
      payload: {
        workspace_id: workspaceId,
        document_id: row!.id,
        chunk_index: 0,
        text: "The zephyrine allowance is 40 euros a day.",
        filename: "travel-policy.pdf",
        page: 2,
      },
      dense: new Array(1536).fill(0.01),
      sparse: sparseVector("The zephyrine allowance is 40 euros a day."),
    },
  ]);
  return { user, base: `/workspaces/${workspaceId}`, documentId: row!.id };
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`${base}/chat`)
    .set("Authorization", bearer(user))
    .send(body)
    .buffer(true)
    .parse((response, callback) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (text += chunk));
      response.on("end", () => callback(null, text));
    });
  return (res.body as string)
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}

const ofType = <T extends ChatEvent["type"]>(events: ChatEvent[], type: T) =>
  events.filter((event): event is Extract<ChatEvent, { type: T }> => event.type === type);

describe("answers from documents", () => {
  it("searches, streams the sources, and saves which ones the answer cites", async () => {
    const { user, base, documentId } = await userWithDocument();
    const events = await chat(user, base, { content: "What is the zephyrine allowance?" });

    expect(events.map((event) => event.type).slice(0, 4)).toEqual([
      "start",
      "status",
      "sources",
      "status",
    ]);
    expect(ofType(events, "status").map((event) => event.stage)).toEqual(["searching", "writing"]);
    const [streamed] = ofType(events, "sources");
    expect(streamed!.sources).toEqual([
      {
        id: 1,
        documentId,
        filename: "travel-policy.pdf",
        page: 2,
        chunkIndex: 0,
        text: "The zephyrine allowance is 40 euros a day.",
        cited: false,
      },
    ]);

    const [done] = ofType(events, "done");
    expect(done!.message.content).toMatch(/\[1\]$/);
    expect(done!.message.sources).toEqual([{ ...streamed!.sources[0], cited: true }]);

    // The thread keeps the sources, so citations still work after a reload.
    const threadId = ofType(events, "start")[0]!.thread.id;
    const thread = await request(app)
      .get(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1].sources[0]).toMatchObject({ id: 1, cited: true });

    const features = (
      await ownerDb().select().from(usageEvents).where(eq(usageEvents.userId, user.auth.user.id))
    ).map((row) => row.feature);
    expect(features.filter((feature) => feature === "rag")).toHaveLength(3); // router, query embedding, reranker
    expect(features).toContain("chat");
  });

  it("answers directly when the router decides documents won't help", async () => {
    const { user, base } = await userWithDocument();
    const events = await chat(user, base, { content: "MOCK_DIRECT write a haiku" });
    expect(ofType(events, "status")).toHaveLength(2);
    expect(ofType(events, "sources")).toHaveLength(0);
    expect(ofType(events, "done")[0]!.message.sources).toEqual([]);
  });

  it("never searches when the user turns documents off", async () => {
    const { user, base } = await userWithDocument();
    gateway.reset();
    const events = await chat(user, base, { content: "zephyrine allowance?", knowledge: "off" });
    expect(ofType(events, "status")).toHaveLength(0);
    expect(gateway.requests.some((r) => JSON.stringify(r.body).includes("route_message"))).toBe(
      false,
    );
  });

  it("skips search entirely in a workspace with no ready documents", async () => {
    const user = await signUp(app);
    const workspaceId = (await request(app).get("/workspaces").set("Authorization", bearer(user)))
      .body.workspaces[0].id;
    const events = await chat(user, `/workspaces/${workspaceId}`, {
      content: "zephyrine allowance?",
    });
    expect(ofType(events, "status")).toHaveLength(0);
    expect(ofType(events, "done")).toHaveLength(1);
  });

  it("still answers when search breaks", async () => {
    const broken = createTestApp({
      ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
      storage: { objects: memoryObjectStore(), uploads: memoryUploadQueue(), uploadEvents: "api" },
      vectorIndex: {
        ...memoryVectorIndex(),
        search: () => Promise.reject(new Error("Qdrant down")),
      },
    });
    const { user, base } = await userWithDocument();
    const res = await request(broken)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ content: "zephyrine allowance?" })
      .buffer(true)
      .parse((response, callback) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString()));
        response.on("end", () => callback(null, text));
      });
    expect(res.body).toContain("event: done");
    expect(res.body).not.toContain("event: sources");
  });
});
