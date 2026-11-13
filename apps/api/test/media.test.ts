import { aiEnvSchema, createImageGenerator, createVideoGenerator } from "@tessel/ai";
import { solidPng, startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { ChatEvent, MediaItem } from "@tessel/contracts";
import { billingAccounts, media, usageEvents } from "@tessel/db";
import type { VideoJobData } from "@tessel/queue";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { and, eq } from "drizzle-orm";
import type { Express } from "express";
import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { bearer, connect, createTestAi, createTestApp, signUp, type SignedUpUser } from "./helpers";

let gateway: MockGateway;
let app: Express;
let appWithoutImages: Express;
const videoJobs: { job: VideoJobData; delay: number | undefined }[] = [];
const objects = memoryObjectStore();
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

beforeAll(async () => {
  gateway = await startMockGateway();
  const ai = createTestAi({
    gatewayUrl: gateway.url,
    moderation: { mode: "off", failure: "allow" },
  });
  const images = createImageGenerator(
    aiEnvSchema.parse({
      AI_GATEWAY_API_KEY: "test",
      AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
    }),
  );
  const sdkEnv = aiEnvSchema.parse({
    AI_GATEWAY_API_KEY: "test",
    AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
  });
  app = createTestApp({
    ai,
    images,
    videos: {
      generator: createVideoGenerator(sdkEnv)!,
      queue: { enqueueVideo: async (job, delay) => void videoJobs.push({ job, delay }) },
    },
    storage: { objects, uploads: memoryUploadQueue(), uploadEvents: "api" },
  });
  appWithoutImages = createTestApp({ ai });
});
afterAll(() => gateway.close());

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

const parse = (body: string): ChatEvent[] =>
  body
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)) as ChatEvent);

async function setup(on: Express = app) {
  const user = await signUp(on);
  const workspaceId = (await request(on).get("/workspaces").set("Authorization", bearer(user))).body
    .workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}` };
}

async function chat(user: SignedUpUser, base: string, body: Record<string, unknown>, on = app) {
  const res = await readEvents(
    request(on).post(`${base}/chat`).set("Authorization", bearer(user)).send(body),
  );
  return parse(res.body as string);
}

const done = (events: ChatEvent[]) =>
  events.find((event): event is Extract<ChatEvent, { type: "done" }> => event.type === "done")!;
const threadOf = (events: ChatEvent[]) =>
  events.find((event): event is Extract<ChatEvent, { type: "start" }> => event.type === "start")!
    .thread.id;

describe("images in chat", () => {
  it("generates an image, shows it on the reply, and saves it to the gallery", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, {
      content: tools({
        name: "generate_image",
        args: { prompt: "A teal fox in the snow", aspect_ratio: "16:9" },
      }),
      knowledge: "off",
    });
    const reply = done(events);
    expect(reply.status).toBe("complete");
    const call = reply.message.toolCalls[0]!;
    expect(call).toMatchObject({ name: "generate_image", status: "completed" });
    expect(call.media).toEqual([
      {
        kind: "image",
        id: expect.any(String),
        width: 96,
        height: 54,
        alt: "A teal fox in the snow",
      },
    ]);
    // The model is told the ID, so it can edit the image later.
    expect(reply.message.content).toContain(call.media![0]!.id);

    const gallery = await request(app).get(`${base}/media`).set("Authorization", bearer(user));
    expect(gallery.status).toBe(200);
    expect(gallery.body.items).toHaveLength(1);
    const item = gallery.body.items[0] as MediaItem;
    expect(item).toMatchObject({
      id: call.media![0]!.id,
      kind: "image",
      status: "ready",
      prompt: "A teal fox in the snow",
      modelId: "openai/gpt-image-2",
      threadId: threadOf(events),
      mediaType: "image/png",
      width: 96,
      height: 54,
    });

    const file = await request(app)
      .get(`${base}/media/${item.id}/content`)
      .set("Authorization", bearer(user))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toContain("immutable");
    expect((await sharp(file.body as Buffer).metadata()).width).toBe(96);

    const preview = await request(app)
      .get(`${base}/media/${item.id}/content?variant=preview`)
      .set("Authorization", bearer(user));
    expect(preview.headers["content-type"]).toBe("image/webp");

    // Recorded in the ledger at the gateway's price.
    const usage = await ownerDb()
      .select()
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, user.auth.user.id), eq(usageEvents.feature, "image")));
    expect(usage).toHaveLength(1);
    expect(usage[0]?.costNanoUsd).toBe(40_000_000);
  });

  it("edits the newest image in the chat, keeping its shape", async () => {
    const { user, base } = await setup();
    const first = await chat(user, base, {
      content: tools({
        name: "generate_image",
        args: { prompt: "A lighthouse", aspect_ratio: "9:16" },
      }),
      knowledge: "off",
    });
    const threadId = threadOf(first);
    const original = done(first).message.toolCalls[0]!.media![0]!;

    const edited = await chat(user, base, {
      threadId,
      content: tools({ name: "edit_image", args: { prompt: "Make it night" } }),
      knowledge: "off",
    });
    const call = done(edited).message.toolCalls[0]!;
    expect(call).toMatchObject({ name: "edit_image", status: "completed" });
    expect(call.media![0]).toMatchObject({ width: 54, height: 96 });
    // The source went to the model as a file.
    const sent = gateway.requests.filter((entry) => entry.path.endsWith("/image-model")).at(-1)!;
    expect((sent.body as { files?: unknown[] }).files).toHaveLength(1);
    expect(sent.body).toMatchObject({ aspectRatio: "9:16" });

    const [row] = await ownerDb().select().from(media).where(eq(media.id, call.media![0]!.id));
    expect(row?.sourceIds).toEqual([original.id]);
  });

  it("edits an image the user attached", async () => {
    const { user, base } = await setup();
    const upload = await request(app)
      .post(`${base}/attachments`)
      .set("Authorization", bearer(user))
      .attach("file", solidPng(40, 30, [200, 10, 10]), "photo.png");
    expect(upload.status).toBe(201);
    const events = await chat(user, base, {
      content: tools({
        name: "edit_image",
        args: { prompt: "Add a hat", image_id: upload.body.id },
      }),
      attachmentIds: [upload.body.id],
      knowledge: "off",
    });
    const call = done(events).message.toolCalls[0]!;
    expect(call.status).toBe("completed");
    // 40×30 is closest to 4:3.
    const sent = gateway.requests.filter((entry) => entry.path.endsWith("/image-model")).at(-1)!;
    expect(sent.body).toMatchObject({ aspectRatio: "4:3" });
  });

  it("explains when there's nothing to edit", async () => {
    const { user, base } = await setup();
    const events = await chat(user, base, {
      content: tools({ name: "edit_image", args: { prompt: "Brighter" } }),
      knowledge: "off",
    });
    const call = done(events).message.toolCalls[0]!;
    expect(call.status).toBe("failed");
    expect(call.error).toMatch(/no image in this chat/);
  });

  it("offers no image tools when image generation isn't set up", async () => {
    const { user, base } = await setup(appWithoutImages);
    const events = await chat(
      user,
      base,
      {
        content: tools({ name: "generate_image", args: { prompt: "A fox" } }),
        knowledge: "off",
      },
      appWithoutImages,
    );
    const sent = gateway.requests
      .filter((entry) => entry.path.endsWith("/chat/completions"))
      .at(-1)!;
    const offered = ((sent.body as { tools?: { function: { name: string } }[] }).tools ?? []).map(
      (tool) => tool.function.name,
    );
    expect(offered).not.toContain("generate_image");
    expect(done(events).status).toBe("complete");
    const status = await request(appWithoutImages)
      .get(`${base}/media/status`)
      .set("Authorization", bearer(user));
    expect(status.body).toEqual({ images: false, videos: false });
  });
});

describe("the gallery", () => {
  it("makes and edits images from a prompt, pages newest first, and deletes", async () => {
    const { user, base } = await setup();
    const made: MediaItem[] = [];
    for (const prompt of ["One", "Two", "Three"]) {
      const res = await request(app)
        .post(`${base}/media/images`)
        .set("Authorization", bearer(user))
        .send({ prompt });
      expect(res.status).toBe(201);
      made.push(res.body as MediaItem);
    }
    expect(made[0]).toMatchObject({ threadId: null, width: 96, height: 96 });

    const edit = await request(app)
      .post(`${base}/media/images`)
      .set("Authorization", bearer(user))
      .send({ prompt: "Two, but blue", sourceIds: [made[1]!.id] });
    expect(edit.status).toBe(201);
    expect(edit.body.sourceIds).toEqual([made[1]!.id]);

    const page = await request(app).get(`${base}/media?limit=2`).set("Authorization", bearer(user));
    expect(page.body.items.map((item: MediaItem) => item.prompt)).toEqual([
      "Two, but blue",
      "Three",
    ]);
    const next = await request(app)
      .get(`${base}/media?limit=2&before=${encodeURIComponent(page.body.nextCursor)}`)
      .set("Authorization", bearer(user));
    expect(next.body.items.map((item: MediaItem) => item.prompt)).toEqual(["Two", "One"]);
    expect(next.body.nextCursor).toBeNull();

    const removed = await request(app)
      .delete(`${base}/media/${made[0]!.id}`)
      .set("Authorization", bearer(user));
    expect(removed.status).toBe(204);
    const gone = await request(app)
      .get(`${base}/media/${made[0]!.id}/content`)
      .set("Authorization", bearer(user));
    expect(gone.status).toBe(404);
  });

  it("keeps each person's images to themselves", async () => {
    const owner = await setup();
    const made = await request(app)
      .post(`${owner.base}/media/images`)
      .set("Authorization", bearer(owner.user))
      .send({ prompt: "Private" });
    const other = await setup();
    const list = await request(app)
      .get(`${other.base}/media`)
      .set("Authorization", bearer(other.user));
    expect(list.body.items).toEqual([]);
    // Someone else's image can't be read, even naming the owner's workspace.
    const peek = await request(app)
      .get(`${owner.base}/media/${made.body.id}`)
      .set("Authorization", bearer(other.user));
    expect(peek.status).toBe(404);
    // Nor used as a source for an edit.
    const steal = await request(app)
      .post(`${other.base}/media/images`)
      .set("Authorization", bearer(other.user))
      .send({ prompt: "Mine now", sourceIds: [made.body.id] });
    expect(steal.status).toBe(400);
    expect(steal.body.error.code).toBe("image_not_found");
  });

  it("says why when the image model fails", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/media/images`)
      .set("Authorization", bearer(user))
      .send({ prompt: "MOCK_IMAGE_FAIL" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("image_failed");
  });
});

async function decide(user: SignedUpUser, base: string, threadId: string, callId: string) {
  const res = await readEvents(
    request(app)
      .post(`${base}/threads/${threadId}/tool-calls/${encodeURIComponent(callId)}/decision`)
      .set("Authorization", bearer(user))
      .send({ approved: true }),
  );
  return parse(res.body as string);
}

describe("videos", () => {
  async function paid() {
    const ctx = await setup();
    await ownerDb().insert(billingAccounts).values({ workspaceId: ctx.workspaceId, plan: "pro" });
    return ctx;
  }

  it("asks before making a video, then starts it in the background", async () => {
    const { user, base } = await paid();
    const events = await chat(user, base, {
      content: tools({
        name: "generate_video",
        args: { prompt: "Waves at dusk", aspect_ratio: "9:16", duration_seconds: 6 },
      }),
      knowledge: "off",
    });
    const waiting = done(events);
    expect(waiting.status).toBe("waiting");
    const call = waiting.message.toolCalls[0]!;
    expect(call).toMatchObject({
      name: "generate_video",
      status: "waiting",
      description: "Make a 6-second video: Waves at dusk",
    });

    const resumed = await decide(user, base, threadOf(events), call.id);
    const finished = done(resumed).message.toolCalls[0]!;
    expect(finished.status).toBe("completed");
    const video = finished.media![0]!;
    expect(video).toMatchObject({ kind: "video", width: 720, height: 1280 });

    const item = await request(app)
      .get(`${base}/media/${video.id}`)
      .set("Authorization", bearer(user));
    expect(item.body).toMatchObject({
      kind: "video",
      status: "pending",
      progress: 0,
      durationMs: 6000,
      modelId: "google/veo-3.1-fast-generate-001",
      threadId: threadOf(events),
    });
    // The worker is asked to check on it.
    expect(videoJobs.at(-1)).toEqual({
      job: { workspaceId: expect.any(String), userId: user.auth.user.id, mediaId: video.id },
      delay: 2000,
    });
    const [row] = await ownerDb().select().from(media).where(eq(media.id, video.id));
    expect(row?.operation).toEqual({ id: expect.stringMatching(/^mock-video-/) });
    // Not playable until it's done.
    const content = await request(app)
      .get(`${base}/media/${video.id}/content`)
      .set("Authorization", bearer(user));
    expect(content.status).toBe(404);
  });

  it("starts a video from the gallery, from an image", async () => {
    const { user, base } = await paid();
    const still = await request(app)
      .post(`${base}/media/images`)
      .set("Authorization", bearer(user))
      .send({ prompt: "A lighthouse" });
    const res = await request(app)
      .post(`${base}/media/videos`)
      .set("Authorization", bearer(user))
      .send({ prompt: "The light turns on", sourceId: still.body.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "video",
      status: "pending",
      sourceIds: [still.body.id],
    });
    const started = gateway.requests
      .filter((entry) => entry.path.endsWith("/video-model/start"))
      .at(-1)!;
    expect(started.body).toMatchObject({
      prompt: "The light turns on",
      duration: 8,
      aspectRatio: "16:9",
    });
    expect((started.body as { image?: unknown }).image).toBeDefined();
  });

  it("needs a paid plan", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/media/videos`)
      .set("Authorization", bearer(user))
      .send({ prompt: "Waves" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("video_requires_plan");
  });
});
