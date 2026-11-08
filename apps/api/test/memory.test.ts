import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { messages, threads, workspaceMembers } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import {
  createMemoryStore,
  KEEP_RECENT,
  memoryEpisodeIndex,
  processThreadMemory,
} from "@tessel/memory";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import {
  bearer,
  connect,
  createTestAi,
  createTestApp,
  recordingMemoryQueue,
  signUp,
  type SignedUpUser,
} from "./helpers";

let gateway: MockGateway;
let app: Express;
const episodes = memoryEpisodeIndex();
const queue = recordingMemoryQueue();
const logger = createLogger("memory-test", { level: "silent", pretty: false });

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    memory: { episodes, queue },
  });
});
afterAll(() => gateway.close());
beforeEach(() => {
  gateway.reset();
  queue.jobs.length = 0;
});

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>) {
  const res = await readEvents(
    request(app)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ knowledge: "off", ...body }),
  );
  const events = (res.body as string)
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
  const start = events.find((event) => event.type === "start");
  const done = events.find((event) => event.type === "done");
  if (start?.type !== "start" || done?.type !== "done") throw new Error("Reply didn't finish");
  return { threadId: start.thread.id, message: done.message };
}

/** Runs the worker's memory job for every chat the API queued. */
async function runMemoryJobs() {
  const processor = {
    store: createMemoryStore(connect().db),
    ai: createTestAi({ gatewayUrl: gateway.url }),
    episodes,
    logger,
  };
  const reports = [];
  for (const job of queue.jobs.splice(0)) reports.push(await processThreadMemory(processor, job));
  return reports;
}

const replySystemPrompt = () => {
  const reply = gateway.requests.findLast((r) => r.body.stream === true)!;
  return (reply.body.messages as { role: string; content: string }[])[0]!.content;
};
const offeredTools = () =>
  (
    (gateway.requests.findLast((r) => r.body.stream === true)!.body.tools ?? []) as {
      function: { name: string };
    }[]
  ).map((tool) => tool.function.name);

describe("memory", () => {
  it("lets users add, edit, and delete memories, privately", async () => {
    const { user, workspaceId, base } = await setup();
    const created = await request(app)
      .post(`${base}/memory/memories`)
      .set("Authorization", bearer(user))
      .send({ content: "Works in the Bengaluru office." });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      source: "user",
      content: "Works in the Bengaluru office.",
    });

    const edited = await request(app)
      .patch(`${base}/memory/memories/${created.body.id}`)
      .set("Authorization", bearer(user))
      .send({ content: "Works in the Noida office." });
    expect(edited.body.content).toBe("Works in the Noida office.");

    const teammate = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: teammate.auth.user.id, role: "admin" });
    const theirs = await request(app).get(`${base}/memory`).set("Authorization", bearer(teammate));
    expect(theirs.body.memories).toEqual([]);
    const sneaky = await request(app)
      .delete(`${base}/memory/memories/${created.body.id}`)
      .set("Authorization", bearer(teammate));
    expect(sneaky.status).toBe(404);

    const mine = await request(app).get(`${base}/memory`).set("Authorization", bearer(user));
    expect(mine.body).toMatchObject({
      settings: { memoryEnabled: true, chatSearchEnabled: true },
      memories: [{ content: "Works in the Noida office." }],
    });
    await request(app).delete(`${base}/memory/memories`).set("Authorization", bearer(user));
    expect(
      (await request(app).get(`${base}/memory`).set("Authorization", bearer(user))).body.memories,
    ).toEqual([]);
  });

  it("remembers facts from a chat and uses them in later chats", async () => {
    const { user, base } = await setup();
    await chat(user, base, { content: "MOCK_REMEMBER: Leads the payments team at Acme." });
    expect(queue.jobs).toHaveLength(1);
    const [report] = await runMemoryJobs();
    expect(report).toMatchObject({ added: 1, indexed: true });

    const memory = await request(app).get(`${base}/memory`).set("Authorization", bearer(user));
    expect(memory.body.memories).toEqual([
      expect.objectContaining({ content: "Leads the payments team at Acme.", source: "chat" }),
    ]);

    await chat(user, base, { content: "What should I work on today?" });
    expect(replySystemPrompt()).toContain(
      "<memories>\n- Leads the payments team at Acme.\n</memories>",
    );
  });

  it("forgets on request", async () => {
    const { user, base } = await setup();
    await request(app)
      .post(`${base}/memory/memories`)
      .set("Authorization", bearer(user))
      .send({ content: "Prefers Python." });
    await chat(user, base, { content: "MOCK_FORGET everything you know about me" });
    const [report] = await runMemoryJobs();
    expect(report!.removed).toBe(1);
    expect(
      (await request(app).get(`${base}/memory`).set("Authorization", bearer(user))).body.memories,
    ).toEqual([]);
  });

  it("saves what the user asks the agent to remember", async () => {
    const { user, base } = await setup();
    const { message } = await chat(user, base, {
      content: `MOCK_TOOLS ${JSON.stringify([{ name: "remember", args: { content: "Prefers short answers." } }])}`,
    });
    expect(message.toolCalls[0]).toMatchObject({
      name: "remember",
      title: "Remember",
      status: "completed",
    });
    const memory = await request(app).get(`${base}/memory`).set("Authorization", bearer(user));
    expect(memory.body.memories[0]).toMatchObject({
      content: "Prefers short answers.",
      source: "tool",
    });
  });

  it("summarizes long chats and sends only recent turns in full", async () => {
    const { user, workspaceId, base } = await setup();
    const first = await chat(user, base, { content: "Let's plan the launch." });
    const thread = first.threadId;
    const start = Date.now() + 1000;
    await ownerDb()
      .insert(messages)
      .values(
        Array.from({ length: 30 }, (_, index) => ({
          threadId: thread,
          workspaceId,
          userId: user.auth.user.id,
          role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
          content: `Turn ${index}`,
          status: "complete" as const,
          createdAt: new Date(start + index * 1000),
        })),
      );
    const [report] = await runMemoryJobs();
    expect(report!.summarized).toBe(true);
    const [row] = await ownerDb().select().from(threads).where(eq(threads.id, thread));
    expect(row!.summary).toMatch(/^Summary of \d+ earlier turns\.$/);

    gateway.reset();
    await chat(user, base, { threadId: thread, content: "Where were we?" });
    const reply = gateway.requests.findLast((r) => r.body.stream === true)!;
    const sent = reply.body.messages as { role: string; content: string }[];
    expect(sent[0]!.content).toContain("<summary>\nSummary of");
    // The newest turns, the new message (and possibly the reply's user turn) only.
    expect(sent.length).toBeLessThanOrEqual(KEEP_RECENT + 3);
    expect(JSON.stringify(sent)).not.toContain("Turn 0");
    expect(JSON.stringify(sent)).toContain("Turn 29");
  });

  it("finds earlier chats with search_past_chats, and forgets deleted ones", async () => {
    const { user, base } = await setup();
    const earlier = await chat(user, base, {
      content: "Zanzibar offsite budget is 12,000 dollars",
    });
    await runMemoryJobs();

    const { message } = await chat(user, base, {
      content: `MOCK_TOOLS ${JSON.stringify([{ name: "search_past_chats", args: { query: "zanzibar offsite" } }])}`,
    });
    expect(message.toolCalls[0]).toMatchObject({
      name: "search_past_chats",
      summary: "Found 1 chat",
    });
    expect(message.content).toContain(`<chat id="${earlier.threadId}"`);
    expect(message.content).toContain("Zanzibar offsite budget");

    await request(app)
      .delete(`${base}/threads/${earlier.threadId}`)
      .set("Authorization", bearer(user));
    expect(episodes.episodes.has(earlier.threadId)).toBe(false);
  });

  it("follows the memory settings", async () => {
    const { user, base } = await setup();
    await request(app)
      .post(`${base}/memory/memories`)
      .set("Authorization", bearer(user))
      .send({ content: "Uses Rust." });
    await chat(user, base, { content: "Index this chat about llamas" });
    await runMemoryJobs();

    const saved = await request(app)
      .put(`${base}/memory/settings`)
      .set("Authorization", bearer(user))
      .send({ memoryEnabled: false, chatSearchEnabled: false });
    expect(saved.body).toEqual({ memoryEnabled: false, chatSearchEnabled: false });
    expect(
      [...episodes.episodes.values()].some((e) => e.payload.user_id === user.auth.user.id),
    ).toBe(false);

    await chat(user, base, { content: "MOCK_REMEMBER: Likes llamas." });
    expect(replySystemPrompt()).not.toContain("Uses Rust.");
    expect(offeredTools()).not.toContain("remember");
    expect(offeredTools()).not.toContain("search_past_chats");
    const [report] = await runMemoryJobs();
    expect(report).toMatchObject({ added: 0, indexed: false });
  });
});
