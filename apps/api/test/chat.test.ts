import type { AddressInfo } from "node:net";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent } from "@tessel/contracts";
import { threads, usageEvents, withUserContext, workspaceMembers } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({ ai: createTestAi({ gatewayUrl: gateway.url }) });
});
afterAll(() => gateway.close());
beforeEach(() => gateway.reset());

const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

function parseEvents(body: string): ChatEvent[] {
  return body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);
}

async function setup(): Promise<{ user: SignedUpUser; workspaceId: string; base: string }> {
  const user = await signUp(app);
  const res = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = res.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

async function send(user: SignedUpUser, base: string, body: Record<string, unknown>) {
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
  if (res.status !== 200) res.body = JSON.parse(res.body as string);
  return { res, events: res.status === 200 ? parseEvents(res.body as string) : [] };
}

const chatRequests = () => gateway.requests.filter((r) => r.path.endsWith("/chat/completions"));
/** The chat call itself, not moderation or title calls. */
const replyRequest = () =>
  chatRequests().find((r) => {
    const names = ((r.body.tools as { function: { name: string } }[] | undefined) ?? []).map(
      (tool) => tool.function.name,
    );
    // The reply offers the workspace tools; helper calls offer only their own.
    return r.body.stream === true && (names.length === 0 || names.includes("search_documents"));
  });

describe("chat", () => {
  it("streams a reply, saves both messages, and names the new chat", async () => {
    const { user, base } = await setup();
    const { res, events } = await send(user, base, {
      content: "Plan a launch for our new product",
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const types = events.map((event) => event.type);
    expect(types[0]).toBe("start");
    expect(types.filter((type) => type === "token").length).toBeGreaterThan(1);
    expect(types.slice(-2)).toEqual(["done", "title"]);

    const start = events[0] as Extract<ChatEvent, { type: "start" }>;
    const text = events
      .filter((event): event is Extract<ChatEvent, { type: "token" }> => event.type === "token")
      .map((event) => event.text)
      .join("");
    expect(text).toBe("Echo: Plan a launch for our new product");
    expect(events.at(-1)).toEqual({
      type: "title",
      threadId: start.thread.id,
      title: "Plan a launch for",
    });

    const thread = await request(app)
      .get(`${base}/threads/${start.thread.id}`)
      .set("Authorization", bearer(user));
    expect(thread.body.thread).toMatchObject({
      title: "Plan a launch for",
      modelId: "anthropic/claude-sonnet-5",
    });
    expect(
      thread.body.messages.map((m: { role: string; status: string }) => [m.role, m.status]),
    ).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(thread.body.messages[1].content).toBe(text);

    const list = await request(app).get(`${base}/threads`).set("Authorization", bearer(user));
    expect(list.body.threads.map((t: { id: string }) => t.id)).toEqual([start.thread.id]);

    const ledger = await ownerDb()
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.userId, user.auth.user.id));
    // The message and the finished reply are both moderated.
    expect(ledger.map((row) => row.feature).sort()).toEqual([
      "chat",
      "moderation",
      "moderation",
      "title",
    ]);
  });

  it("sends earlier turns as context when continuing a chat", async () => {
    const { user, base } = await setup();
    const first = await send(user, base, { content: "First question" });
    const threadId = (first.events[0] as Extract<ChatEvent, { type: "start" }>).thread.id;
    gateway.reset();

    const second = await send(user, base, {
      threadId,
      content: "Follow-up",
      model: "openai/gpt-5.4-mini",
    });
    expect(second.events.map((e) => e.type)).not.toContain("title");
    const roles = (replyRequest()!.body.messages as { role: string }[]).map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(replyRequest()!.body.model).toBe("openai/gpt-5.4-mini");

    const thread = await request(app)
      .get(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user));
    expect(thread.body.thread.modelId).toBe("openai/gpt-5.4-mini");
    expect(thread.body.messages).toHaveLength(4);
  });

  it("refuses blocked messages and capped users before saving anything", async () => {
    const { user, base } = await setup();
    const blocked = await send(user, base, { content: "MOCK_BLOCK" });
    expect(blocked.res.status).toBe(422);
    expect(blocked.res.body.error.code).toBe("content_blocked");

    const cappedApp = createTestApp({
      ai: createTestAi({
        gatewayUrl: gateway.url,
        limits: { userDailyUsd: 0, workspaceDailyUsd: 0, globalDailyUsd: 0.0000001 },
      }),
    });
    await request(cappedApp)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ content: "Use it up" });
    const capped = await request(cappedApp)
      .post(`${base}/chat`)
      .set("Authorization", bearer(user))
      .send({ content: "One more" });
    expect(capped.status).toBe(429);

    const threadsLeft = await ownerDb()
      .select()
      .from(threads)
      .where(eq(threads.userId, user.auth.user.id));
    expect(threadsLeft).toHaveLength(1); // only the call that went through
  });

  it("saves a failed reply with its error code", async () => {
    const { user, base } = await setup();
    const { events } = await send(user, base, { content: "MOCK_FAIL please" });
    const error = events.find((event) => event.type === "error") as Extract<
      ChatEvent,
      { type: "error" }
    >;
    expect(error).toMatchObject({
      code: "model_unavailable",
      assistantMessage: { status: "error" },
    });
    expect(events.map((e) => e.type)).not.toContain("done");
  });

  it("keeps the partial reply when the user stops it", async () => {
    const { user, base } = await setup();
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    const controller = new AbortController();
    let threadId = "";
    let received = "";
    try {
      const response = await fetch(`http://127.0.0.1:${port}${base}/chat`, {
        method: "POST",
        headers: { Authorization: bearer(user), "Content-Type": "application/json" },
        body: JSON.stringify({ content: "MOCK_SLOW" }),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (received.split("event: token").length < 6) {
        const { value } = await reader.read();
        received += decoder.decode(value);
        threadId ||= /"thread":\{"id":"([^"]+)"/.exec(received)?.[1] ?? "";
      }
      controller.abort();
    } finally {
      server.close();
    }

    await expect
      .poll(async () => {
        const res = await request(app)
          .get(`${base}/threads/${threadId}`)
          .set("Authorization", bearer(user));
        return res.body.messages?.[1]?.status;
      })
      .toBe("stopped");
    const thread = await request(app)
      .get(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user));
    expect(thread.body.messages[1].content).toMatch(/^word0 word1 /);
    expect(thread.body.messages[1].content).not.toContain("word199");

    await expect
      .poll(async () => {
        const rows = await ownerDb()
          .select()
          .from(usageEvents)
          .where(eq(usageEvents.userId, user.auth.user.id));
        return rows.find((row) => row.feature === "chat")?.status;
      })
      .toBe("aborted");
  });

  it("renames and deletes chats", async () => {
    const { user, base } = await setup();
    const { events } = await send(user, base, { content: "Hello" });
    const threadId = (events[0] as Extract<ChatEvent, { type: "start" }>).thread.id;

    const renamed = await request(app)
      .patch(`${base}/threads/${threadId}`)
      .set("Authorization", bearer(user))
      .send({ title: "  Launch plan  " });
    expect(renamed.body.title).toBe("Launch plan");

    expect(
      (await request(app).delete(`${base}/threads/${threadId}`).set("Authorization", bearer(user)))
        .status,
    ).toBe(204);
    expect(
      (await request(app).get(`${base}/threads/${threadId}`).set("Authorization", bearer(user)))
        .status,
    ).toBe(404);
  });

  it("keeps chats private, even from teammates in the same workspace", async () => {
    const { user, workspaceId, base } = await setup();
    const teammate = await signUp(app);
    await ownerDb()
      .insert(workspaceMembers)
      .values({ workspaceId, userId: teammate.auth.user.id, role: "admin" });
    const { events } = await send(user, base, { content: "Private thoughts" });
    const threadId = (events[0] as Extract<ChatEvent, { type: "start" }>).thread.id;

    const asTeammate = (path: string) =>
      request(app).get(path).set("Authorization", bearer(teammate));
    expect((await asTeammate(`${base}/threads/${threadId}`)).status).toBe(404);
    expect((await asTeammate(`${base}/threads`)).body.threads).toEqual([]);
    const continued = await send(teammate, base, { threadId, content: "Let me in" });
    expect(continued.res.status).toBe(404);

    // Row-level security hides the rows even without the code's filters.
    const visible = await withUserContext(connect().db, teammate.auth.user.id, (tx) =>
      tx.select().from(threads),
    );
    expect(visible.find((row) => row.id === threadId)).toBeUndefined();
  });
});

describe("attachments", () => {
  async function upload(user: SignedUpUser, base: string, name: string, content: Buffer) {
    return request(app)
      .post(`${base}/attachments`)
      .set("Authorization", bearer(user))
      .attach("file", content, name);
  }

  it("inlines text files into the message as data", async () => {
    const { user, base } = await setup();
    const file = await upload(user, base, "notes.md", Buffer.from("# Q3 goals\nShip chat."));
    expect(file.status).toBe(201);
    expect(file.body).toMatchObject({
      filename: "notes.md",
      kind: "text",
      mediaType: "text/plain",
    });

    const { events } = await send(user, base, {
      content: "Summarise this",
      attachmentIds: [file.body.id],
    });
    const start = events[0] as Extract<ChatEvent, { type: "start" }>;
    expect(start.userMessage.attachments).toEqual([file.body]);
    const lastUser = (replyRequest()!.body.messages as { role: string; content: string }[]).at(-1)!;
    expect(lastUser.content).toContain(
      '<attachment name="notes.md">\n# Q3 goals\nShip chat.\n</attachment>',
    );

    // An attachment belongs to one message only.
    const reused = await send(user, base, { content: "Again", attachmentIds: [file.body.id] });
    expect(reused.res.status).toBe(400);
    expect(reused.res.body.error.code).toBe("invalid_attachments");
  });

  it("sends images to models that can read them", async () => {
    const { user, base } = await setup();
    const image = await upload(user, base, "chart.png", PNG);
    expect(image.body).toMatchObject({ kind: "image", mediaType: "image/png" });

    const noVision = await send(user, base, {
      content: "What's in this?",
      model: "deepseek/deepseek-v4-flash",
      attachmentIds: [image.body.id],
    });
    expect(noVision.res.status).toBe(400);
    expect(noVision.res.body.error.code).toBe("model_cannot_read_images");

    const { events } = await send(user, base, {
      content: "What's in this?",
      attachmentIds: [image.body.id],
    });
    const done = events.find((event) => event.type === "done") as Extract<
      ChatEvent,
      { type: "done" }
    >;
    expect(done.message.content).toBe("Echo: What's in this? [1 image]");

    const content = await request(app)
      .get(`${base}/attachments/${image.body.id}/content`)
      .set("Authorization", bearer(user));
    expect(content.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(content.body as Buffer, PNG)).toBe(0);
  });

  it("rejects files it can't read and hides other people's files", async () => {
    const { user, base } = await setup();
    const pdf = await upload(user, base, "report.pdf", Buffer.from("%PDF-1.7\n%âã\n1 0 obj"));
    expect(pdf.status).toBe(415);
    const fake = await upload(user, base, "photo.png", Buffer.from("not really a png"));
    expect(fake.status).toBe(415);
    const big = await upload(user, base, "big.txt", Buffer.alloc(2 * 1024 * 1024, "a"));
    expect(big.status).toBe(413);

    const file = await upload(user, base, "notes.txt", Buffer.from("secret"));
    const other = await signUp(app);
    const otherWorkspace = (
      await request(app).get("/workspaces").set("Authorization", bearer(other))
    ).body.workspaces[0].id;
    const stolen = await send(other, `/workspaces/${otherWorkspace}`, {
      content: "Read it",
      attachmentIds: [file.body.id],
    });
    expect(stolen.res.status).toBe(400);
    const peek = await request(app)
      .get(`${base}/attachments/${file.body.id}/content`)
      .set("Authorization", bearer(other));
    expect(peek.status).toBe(404);
  });
});
