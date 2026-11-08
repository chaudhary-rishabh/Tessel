import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { documents, usageEvents } from "@tessel/db";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url }),
    storage: { objects: memoryObjectStore(), uploads: memoryUploadQueue(), uploadEvents: "api" },
  });
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

function readEvents(req: request.Test) {
  return req.buffer(true).parse((response, callback) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => (text += chunk));
    response.on("end", () => callback(null, text));
  });
}

const parse = (body: string): ChatEvent[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>) {
  const res = await readEvents(
    request(app)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ knowledge: "off", ...body }),
  );
  return parse(res.body as string);
}

const finalOf = (events: ChatEvent[]) => {
  const done = events.find((event) => event.type === "done");
  if (done?.type !== "done") throw new Error("No done event");
  return done;
};
const threadOf = (events: ChatEvent[]) => {
  const start = events[0];
  if (start?.type !== "start") throw new Error("No start event");
  return start.thread.id;
};
const lastActivity = (events: ChatEvent[]) =>
  events.findLast((event) => event.type === "activity")?.items ?? [];

describe("agent modes", () => {
  it("plans, works through the steps, and answers from the results", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, { content: "Compare our two offices", mode: "plan" });

    const steps = lastActivity(events);
    expect(steps.map((step) => [step.kind, step.title, step.status])).toEqual([
      ["plan", "Gather the facts", "done"],
      ["plan", "Work out the answer", "done"],
    ]);
    const { message } = finalOf(events);
    expect(message).toMatchObject({
      content: "Answer from 2 results.",
      agentMode: "plan",
      activity: [{ status: "done" }, { status: "done" }],
    });

    const ledger = await ownerDb()
      .select({ feature: usageEvents.feature })
      .from(usageEvents)
      .where(eq(usageEvents.userId, user.auth.user.id));
    // Planning and progress checks are recorded as agent calls.
    expect(ledger.filter((row) => row.feature === "agent")).toHaveLength(2);

    const thread = await request(app)
      .get(`${base}/threads/${threadOf(events)}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1].activity).toHaveLength(2);
  });

  it("reviews a draft and rewrites it when the reviewer finds issues", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, {
      content: "MOCK_CRITIQUE explain caching",
      mode: "reflect",
    });
    expect(finalOf(events).message.content).toBe("Revised answer with a one-line summary.");
    expect(lastActivity(events).map((item) => item.title)).toEqual([
      "Write a draft",
      "Review the draft",
      "Fix the issues",
    ]);
  });

  it("hands work to the team and writes from their reports", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, {
      content: "MOCK_TWO_WORKERS what's in the docs?",
      mode: "team",
    });
    expect(lastActivity(events).map((item) => item.title)).toEqual([
      "Researcher: Task for researcher",
      "Analyst: Task for analyst",
    ]);
    expect(finalOf(events).message.content).toBe("Answer from 2 reports.");
  });

  it("pauses a plan step for approval and finishes the plan once allowed", async () => {
    const { user, workspaceId, base } = await setup();
    const events = await chat(user, base, {
      content: `MOCK_ONE_STEP MOCK_TOOLS ${JSON.stringify([
        { name: "create_document", args: { filename: "plan.md", content: "Steps" } },
      ])}`,
      mode: "plan",
    });
    const paused = finalOf(events);
    expect(paused.status).toBe("waiting");
    expect(paused.message.activity).toEqual([expect.objectContaining({ status: "running" })]);
    const threadId = threadOf(events);

    const res = await readEvents(
      request(app)
        .post(
          `${base}/threads/${threadId}/tool-calls/${encodeURIComponent(paused.message.toolCalls[0]!.id)}/decision`,
        )
        .set("Authorization", bearer(user))
        .send({ approved: true }),
    );
    const resumed = parse(res.body as string);
    const done = finalOf(resumed);
    expect(done.status).toBe("complete");
    expect(done.message.content).toBe("Answer from 1 results.");
    expect(done.message.activity).toEqual([
      expect.objectContaining({
        status: "done",
        detail: expect.stringContaining("Created plan.md"),
      }),
    ]);
    const created = await ownerDb()
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId));
    expect(created.map((row) => row.filename)).toEqual(["plan.md"]);
  });

  it("rejects an unknown mode", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ content: "Hi", mode: "chaos" });
    expect(res.status).toBe(400);
  });
});

describe("reply moderation", () => {
  it("removes a finished reply that breaks the usage policy", async () => {
    const { user, base } = await setup();
    // The message passes its check; the reply then contains flagged content.
    gateway.enqueue(
      { toolCall: { name: "moderation_result", args: { categories: [] } } },
      { text: "Here is MOCK_BLOCK material" },
    );
    const events = await chat(user, base, { content: "Tell me something" });

    const error = events.find((event) => event.type === "error");
    expect(error).toMatchObject({
      code: "reply_blocked",
      assistantMessage: { status: "error", content: "", errorCode: "reply_blocked" },
    });
    const threadId = threadOf(events);
    const thread = await request(app)
      .get(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1]).toMatchObject({ content: "", errorCode: "reply_blocked" });
  });
});
