import { memoryVectorIndex, sparseVector } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { agentRuns, documents, workspaceMembers } from "@tessel/db";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;
const objects = memoryObjectStore();
const uploads = memoryUploadQueue();
const index = memoryVectorIndex();

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    storage: { objects, uploads, uploadEvents: "api" },
    vectorIndex: index,
  });
});
afterAll(() => gateway.close());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;
const tools = (...calls: { name: string; args: Record<string, unknown> }[]) =>
  `MOCK_TOOLS ${JSON.stringify(calls)}`;

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

function parse(body: string): ChatEvent[] {
  return body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}

async function setup() {
  const user = await signUp(app);
  const workspaceId = (await request(app).get("/workspaces").set("Authorization", bearer(user)))
    .body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>) {
  const res = await readEvents(
    request(app).post(`${base}/chat`).set("Authorization", bearer(user)).send(body),
  );
  return parse(res.body as string);
}

async function decide(
  user: SignedUpUser,
  base: string,
  threadId: string,
  callId: string,
  approved: boolean,
) {
  const res = await readEvents(
    request(app)
      .post(`${base}/threads/${threadId}/tool-calls/${encodeURIComponent(callId)}/decision`)
      .set("Authorization", bearer(user))
      .send({ approved }),
  );
  return {
    status: res.status,
    events: res.status === 200 ? parse(res.body as string) : [],
    body: res.body,
  };
}

const of = <T extends ChatEvent["type"]>(events: ChatEvent[], type: T) =>
  events.filter((event): event is Extract<ChatEvent, { type: T }> => event.type === type);
const threadOf = (events: ChatEvent[]) => of(events, "start")[0]!.thread.id;
const done = (events: ChatEvent[]) => of(events, "done")[0]!;

describe("tools in chat", () => {
  it("uses read-only tools straight away and saves them on the reply", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, {
      content: tools({ name: "calculator", args: { expression: "6 * 7" } }),
      knowledge: "off",
    });

    expect(of(events, "tool").map((event) => event.call.status)).toEqual(["running", "completed"]);
    const reply = done(events);
    expect(reply.status).toBe("complete");
    expect(reply.message.content).toBe("Tool result: 6 * 7 = 42");
    expect(reply.message.toolCalls).toEqual([
      expect.objectContaining({
        name: "calculator",
        title: "Calculate",
        status: "completed",
        summary: "6 * 7 = 42",
      }),
    ]);

    const thread = await request(app)
      .get(`${base}/threads/${threadOf(events)}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1].toolCalls[0].status).toBe("completed");
  });

  it("pauses before creating a document and creates it once approved", async () => {
    const { user, workspaceId, base } = await setup();
    const events = await chat(user, base, {
      content: tools({
        name: "create_document",
        args: { filename: "launch-notes.md", content: "# Launch\nMay 1st" },
      }),
      knowledge: "off",
    });

    const paused = done(events);
    expect(paused.status).toBe("waiting");
    expect(paused.message.status).toBe("waiting");
    const call = paused.message.toolCalls[0]!;
    expect(call).toMatchObject({
      name: "create_document",
      status: "waiting",
      requiresApproval: true,
      description: 'Create "launch-notes.md" in the workspace (16 characters)',
    });
    expect(
      await ownerDb().select().from(documents).where(eq(documents.workspaceId, workspaceId)),
    ).toEqual([]);

    const threadId = threadOf(events);
    const approved = await decide(user, base, threadId, call.id, true);
    expect(approved.status).toBe(200);
    expect(approved.events[0]).toMatchObject({
      type: "resume",
      message: { id: paused.message.id, status: "streaming" },
    });
    expect(of(approved.events, "tool").map((event) => event.call.status)).toEqual([
      "running",
      "completed",
    ]);
    const finished = done(approved.events);
    expect(finished.status).toBe("complete");
    expect(finished.message.content).toMatch(/Tool result: Created launch-notes\.md/);

    const [document] = await ownerDb()
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId));
    expect(document).toMatchObject({
      filename: "launch-notes.md",
      status: "queued",
      userId: user.auth.user.id,
    });
    expect((await objects.get(document!.storageKey)).toString()).toBe("# Launch\nMay 1st");

    // The same decision can't run twice.
    const again = await decide(user, base, threadId, call.id, true);
    expect(again.status).toBe(409);
  });

  it("tells the model when the user declines", async () => {
    const { user, workspaceId, base } = await setup();
    const events = await chat(user, base, {
      content: tools({ name: "create_document", args: { filename: "nope.md", content: "No" } }),
      knowledge: "off",
    });
    const call = done(events).message.toolCalls[0]!;
    const declined = await decide(user, base, threadOf(events), call.id, false);

    expect(done(declined.events).message.toolCalls[0]!.status).toBe("rejected");
    expect(done(declined.events).message.content).toContain("The user declined this action");
    expect(
      await ownerDb().select().from(documents).where(eq(documents.workspaceId, workspaceId)),
    ).toEqual([]);
  });

  it("cancels a pending action when the user sends a new message instead", async () => {
    const { user, base } = await setup();
    const first = await chat(user, base, {
      content: tools({ name: "create_document", args: { filename: "later.md", content: "Later" } }),
      knowledge: "off",
    });
    const threadId = threadOf(first);
    const call = done(first).message.toolCalls[0]!;

    await chat(user, base, { threadId, content: "Never mind", knowledge: "off" });

    const thread = await request(app)
      .get(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1]).toMatchObject({
      status: "complete",
      toolCalls: [{ status: "cancelled" }],
    });
    const [run] = await ownerDb().select().from(agentRuns).where(eq(agentRuns.threadId, threadId));
    expect(run!.status).toBe("cancelled");
    expect((await decide(user, base, threadId, call.id, true)).status).toBe(409);
  });

  it("keeps approvals private to the chat's owner", async () => {
    const { user, workspaceId, base } = await setup();
    const teammate = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: teammate.auth.user.id, role: "admin" });
    const events = await chat(user, base, {
      content: tools({ name: "create_document", args: { filename: "mine.md", content: "Mine" } }),
      knowledge: "off",
    });
    const result = await decide(
      teammate,
      base,
      threadOf(events),
      done(events).message.toolCalls[0]!.id,
      true,
    );
    expect(result.status).toBe(404);
  });

  it("collects passages found by search_documents as citable sources", async () => {
    const { user, workspaceId, base } = await setup();
    await index.upsert([
      {
        payload: {
          workspace_id: workspaceId,
          document_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          chunk_index: 0,
          text: "The zephyrine allowance is 40 euros a day.",
          filename: "travel.md",
        },
        dense: new Array(1536).fill(0.01),
        sparse: sparseVector("The zephyrine allowance is 40 euros a day."),
      },
    ]);
    const events = await chat(user, base, {
      content: tools({ name: "search_documents", args: { query: "zephyrine allowance" } }),
      knowledge: "off",
    });
    const reply = done(events).message;
    expect(reply.toolCalls[0]).toMatchObject({
      name: "search_documents",
      status: "completed",
      summary: "Found 1 passage",
    });
    expect(reply.sources).toEqual([
      expect.objectContaining({
        id: 1,
        filename: "travel.md",
        text: "The zephyrine allowance is 40 euros a day.",
      }),
    ]);
    expect(reply.content).toContain('<source id="1" document="travel.md">');
  });

  it("reports a tool the user isn't allowed to use as a failed step", async () => {
    const user = await signUp(app);
    const owner = await signUp(app);
    const ownerWorkspace = (
      await request(app).get("/workspaces").set("Authorization", bearer(owner))
    ).body.workspaces[0].id as string;
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId: ownerWorkspace, userId: user.auth.user.id, role: "member" });
    const [document] = await ownerDb()
      .insert(documents)
      .values({
        workspaceId: ownerWorkspace,
        userId: owner.auth.user.id,
        filename: "owners.md",
        mediaType: "text/markdown",
        sizeBytes: 1,
        storageKey: "k",
        status: "ready",
      })
      .returning();
    const memberBase = `/workspaces/${ownerWorkspace}`;
    const events = await chat(user, memberBase, {
      content: tools({ name: "delete_document", args: { document_id: document!.id } }),
      knowledge: "off",
    });
    const call = done(events).message.toolCalls[0]!;
    expect(call.description).toBe('Delete "owners.md" for everyone in the workspace');
    const result = await decide(user, memberBase, threadOf(events), call.id, true);
    expect(done(result.events).message.toolCalls[0]).toMatchObject({
      status: "failed",
      error: "Only the uploader, owners, and admins can delete this document",
    });
    expect(
      await ownerDb().select().from(documents).where(eq(documents.id, document!.id)),
    ).toHaveLength(1);
  });
});
