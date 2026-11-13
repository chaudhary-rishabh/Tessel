import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { STOCK_VOICES } from "@tessel/contracts";
import { messages, threads, usageEvents } from "@tessel/db";
import { and, eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { speakableText } from "../src/modules/voice/speech.service";
import { bearer, connect, createTestAi, createTestApp, signUp } from "./helpers";

let gateway: MockGateway;
let app: Express;
const spoken: { voice: string; text: string }[] = [];
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    voice: {
      maxSessionMinutes: 20,
      speak: async (voice, text) => {
        spoken.push({ voice, text });
        return Buffer.from("mp3");
      },
      transcribe: async () => ({ text: "  Book a table for four at eight  ", seconds: 6 }),
      rates: { sttUsdPerMinute: 0.006, ttsUsdPer1kChars: 0.04 },
    },
  });
});
afterAll(() => gateway.close());

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  const [thread] = await ownerDb()
    .insert(threads)
    .values({ workspaceId, userId: user.auth.user.id, modelId: "openai/gpt-5.4-nano" })
    .returning();
  const [reply] = await ownerDb()
    .insert(messages)
    .values({
      threadId: thread!.id,
      workspaceId,
      userId: user.auth.user.id,
      role: "assistant",
      content:
        "**Sure.** Here's the plan:\n\n- Pack [layers](https://example.com)\n\n```js\nx()\n```",
      status: "complete",
    })
    .returning();
  return { user, workspaceId, replyId: reply!.id, base: `/workspaces/${workspaceId}/voice` };
}

describe("reading replies aloud", () => {
  it("reads a reply in the user's voice, as speech rather than markdown, and records the cost", async () => {
    const ctx = await setup();
    const status = await request(app)
      .get(`${ctx.base}/status`)
      .set("Authorization", bearer(ctx.user));
    expect(status.body).toMatchObject({ readAloud: true, dictation: true });

    const res = await request(app)
      .post(`${ctx.base}/speak`)
      .set("Authorization", bearer(ctx.user))
      .send({ messageId: ctx.replyId });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("audio/mpeg");
    expect(spoken.at(-1)).toEqual({
      voice: STOCK_VOICES[0].providerId,
      text: "Sure. Here's the plan:\nPack layers\nThere's a code block here.",
    });

    const usage = await ownerDb()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, ctx.user.auth.user.id), eq(usageEvents.feature, "voice")));
    expect(usage).toHaveLength(1);
    expect(usage[0]?.costNanoUsd).toBeGreaterThan(0);
  });

  it("reads only the user's own replies", async () => {
    const owner = await setup();
    const other = await setup();
    const res = await request(app)
      .post(`${other.base}/speak`)
      .set("Authorization", bearer(other.user))
      .send({ messageId: owner.replyId });
    expect(res.status).toBe(404);
  });
});

describe("dictation", () => {
  it("turns a recording into text for the composer", async () => {
    const ctx = await setup();
    const res = await request(app)
      .post(`${ctx.base}/transcribe`)
      .set("Authorization", bearer(ctx.user))
      .set("Content-Type", "audio/webm")
      .send(Buffer.from("audio"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: "Book a table for four at eight" });

    const notAudio = await request(app)
      .post(`${ctx.base}/transcribe`)
      .set("Authorization", bearer(ctx.user))
      .set("Content-Type", "application/json")
      .send({});
    expect(notAudio.status).toBe(400);
  });
});

describe("speakable text", () => {
  it("drops markdown, citations, links and tables, and cuts long replies at a sentence", () => {
    expect(speakableText("# Title\n> quoted [1]\n| a | b |\nSee https://x.dev now")).toBe(
      "Title\nquoted\nSee a link now",
    );
    const long = "This is a sentence. ".repeat(300);
    const text = speakableText(long, 200);
    expect(text.length).toBeLessThan(260);
    expect(text).toMatch(/sentence\. That's the start of it; the rest is in the chat\.$/);
  });
});
