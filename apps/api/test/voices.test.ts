import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { DEFAULT_VOICE_ID, STOCK_VOICES } from "@tessel/contracts";
import { auditEvents, billingAccounts, userVoices, voiceSessions } from "@tessel/db";
import { and, eq } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { VoiceCloning } from "../src/modules/voice/elevenlabs";
import { createLiveKitRooms } from "../src/modules/voice/livekit";
import { heardCode } from "../src/modules/voice/voices.service";
import { bearer, connect, createTestAi, createTestApp, signUp } from "./helpers";

const RECORDING = Buffer.from("fake webm audio");

/** ElevenLabs as the tests script it: what it "hears", and the voices it holds. */
function fakeCloning() {
  const state = {
    heard: { text: "", seconds: 30 },
    voices: new Set<string>(),
    deleted: [] as string[],
    spoke: [] as string[],
    next: 1,
  };
  const cloning: VoiceCloning = {
    transcribe: async () => state.heard,
    createVoice: async () => {
      const id = `cloned-${state.next++}`;
      state.voices.add(id);
      return id;
    },
    deleteVoice: async (id) => {
      state.voices.delete(id);
      state.deleted.push(id);
    },
    speak: async (id) => {
      state.spoke.push(id);
      return Buffer.from(`mp3 of ${id}`);
    },
  };
  return { cloning, state };
}

let gateway: MockGateway;
let app: Express;
let freeApp: Express;
const eleven = fakeCloning();
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;
const rooms = createLiveKitRooms({
  url: "http://livekit.invalid:7880",
  publicUrl: "wss://rtc.example.com",
  apiKey: "test-livekit-key",
  apiSecret: "test-livekit-secret-that-is-long-enough-for-hs256",
});

beforeAll(async () => {
  gateway = await startMockGateway();
  const ai = createTestAi({
    gatewayUrl: gateway.url,
    moderation: { mode: "off", failure: "allow" },
  });
  app = createTestApp({
    ai,
    voice: {
      rooms: { ...rooms, closeRoom: async () => undefined },
      maxSessionMinutes: 20,
      cloning: eleven.cloning,
      speak: eleven.cloning.speak,
    },
  });
  // A server without ElevenLabs: stock voices only.
  freeApp = createTestApp({ ai, voice: { rooms, maxSessionMinutes: 20 } });
});
afterAll(() => gateway.close());

async function setup({ paid = true }: { paid?: boolean } = {}) {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  if (paid) await ownerDb().insert(billingAccounts).values({ workspaceId, plan: "pro" });
  return { user, workspaceId, base: `/workspaces/${workspaceId}/voice/voices` };
}

/** Records the passage with the code read correctly, as the browser would upload it. */
async function addVoice(
  ctx: Awaited<ReturnType<typeof setup>>,
  options: { name?: string; heard?: (phrase: string) => string; seconds?: number } = {},
) {
  const challenge = await request(app)
    .post(`${ctx.base}/challenge`)
    .set("Authorization", bearer(ctx.user));
  expect(challenge.status).toBe(200);
  eleven.state.heard = {
    text: (options.heard ?? ((phrase) => `The quick morning light… ${phrase}`))(
      challenge.body.phrase,
    ),
    seconds: options.seconds ?? 30,
  };
  return request(app)
    .post(`${ctx.base}?name=${encodeURIComponent(options.name ?? "Ada's voice")}`)
    .set("Authorization", bearer(ctx.user))
    .set("Content-Type", "audio/webm")
    .set("X-Voice-Challenge", challenge.body.token)
    .send(RECORDING);
}

describe("voices", () => {
  it("lists the stock voices with the default chosen, and offers an own voice on paid plans", async () => {
    const ctx = await setup();
    const res = await request(app).get(ctx.base).set("Authorization", bearer(ctx.user));
    expect(res.status).toBe(200);
    expect(res.body.selectedId).toBe(DEFAULT_VOICE_ID);
    expect(res.body.voices).toHaveLength(STOCK_VOICES.length);
    expect(res.body.ownVoice).toEqual({ available: true });

    const free = await setup({ paid: false });
    const freeList = await request(app).get(free.base).set("Authorization", bearer(free.user));
    expect(freeList.body.ownVoice).toEqual({ available: false, reason: "plan" });
    const refused = await request(app)
      .post(`${free.base}/challenge`)
      .set("Authorization", bearer(free.user));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("own_voice_requires_plan");

    const noProvider = await request(freeApp).get(ctx.base).set("Authorization", bearer(ctx.user));
    expect(noProvider.body.ownVoice).toEqual({ available: false, reason: "not_configured" });
  });

  it("picks a stock voice, which the next conversation speaks with", async () => {
    const ctx = await setup();
    const brian = STOCK_VOICES.find((voice) => voice.name === "Brian")!;
    const picked = await request(app)
      .put(`${ctx.base}/selected`)
      .set("Authorization", bearer(ctx.user))
      .send({ voiceId: `stock:${brian.providerId}` });
    expect(picked.status).toBe(204);
    const list = await request(app).get(ctx.base).set("Authorization", bearer(ctx.user));
    expect(list.body.selectedId).toBe(`stock:${brian.providerId}`);

    const started = await request(app)
      .post(`/workspaces/${ctx.workspaceId}/voice/sessions`)
      .set("Authorization", bearer(ctx.user))
      .send({});
    expect(started.status).toBe(201);
    const [session] = await ownerDb()
      .select({ voiceId: voiceSessions.voiceId })
      .from(voiceSessions)
      .where(eq(voiceSessions.id, started.body.sessionId));
    expect(session?.voiceId).toBe(brian.providerId);

    const unknown = await request(app)
      .put(`${ctx.base}/selected`)
      .set("Authorization", bearer(ctx.user))
      .send({ voiceId: "stock:NotARealVoice123" });
    expect(unknown.status).toBe(404);
  });

  it("adds the user's own voice from a recording with the code read aloud", async () => {
    const ctx = await setup();
    const res = await addVoice(ctx);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "own", name: "Ada's voice" });

    // It's chosen at once, with the consent recorded and the addition audited.
    const list = await request(app).get(ctx.base).set("Authorization", bearer(ctx.user));
    expect(list.body.selectedId).toBe(res.body.id);
    const [row] = await ownerDb()
      .select()
      .from(userVoices)
      .where(eq(userVoices.userId, ctx.user.auth.user.id));
    expect(row?.consentPhrase).toMatch(/^This is my own voice, and my code is (\w+ ){3}\w+\.$/);
    const audited = await ownerDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.actorId, ctx.user.auth.user.id), eq(auditEvents.action, "voice.added")),
      );
    expect(audited).toHaveLength(1);

    // Conversations now speak with the cloned voice.
    const started = await request(app)
      .post(`/workspaces/${ctx.workspaceId}/voice/sessions`)
      .set("Authorization", bearer(ctx.user))
      .send({});
    const [session] = await ownerDb()
      .select({ voiceId: voiceSessions.voiceId })
      .from(voiceSessions)
      .where(eq(voiceSessions.id, started.body.sessionId));
    expect(session?.voiceId).toBe(row?.providerVoiceId);

    // A preview speaks with it.
    const preview = await request(app)
      .get(`${ctx.base}/${encodeURIComponent(res.body.id)}/preview`)
      .set("Authorization", bearer(ctx.user));
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toBe("audio/mpeg");
    expect(eleven.state.spoke.at(-1)).toBe(row?.providerVoiceId);
  });

  it("refuses a recording without the code, too short, or with a stale or someone else's challenge", async () => {
    const ctx = await setup();
    const missing = await addVoice(ctx, { heard: () => "The quick morning light spread over" });
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("voice_code_not_heard");

    const short = await addVoice(ctx, { seconds: 6 });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe("voice_recording_too_short");

    // Another user's challenge doesn't work for this one.
    const other = await setup();
    const theirs = await request(app)
      .post(`${other.base}/challenge`)
      .set("Authorization", bearer(other.user));
    eleven.state.heard = { text: theirs.body.phrase, seconds: 30 };
    const stolen = await request(app)
      .post(ctx.base)
      .set("Authorization", bearer(ctx.user))
      .set("Content-Type", "audio/webm")
      .set("X-Voice-Challenge", theirs.body.token)
      .send(RECORDING);
    expect(stolen.status).toBe(400);

    const forged = await request(app)
      .post(ctx.base)
      .set("Authorization", bearer(ctx.user))
      .set("Content-Type", "audio/webm")
      .set("X-Voice-Challenge", `${theirs.body.token.split(".")[0]}.forged`)
      .send(RECORDING);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe("voice_challenge_invalid");

    const notAudio = await request(app)
      .post(ctx.base)
      .set("Authorization", bearer(ctx.user))
      .set("Content-Type", "text/plain")
      .set("X-Voice-Challenge", theirs.body.token)
      .send("hello");
    expect(notAudio.status).toBe(400);
  });

  it("replaces an earlier voice, and deletes it here and at ElevenLabs", async () => {
    const ctx = await setup();
    const first = await addVoice(ctx, { name: "First" });
    const second = await addVoice(ctx, { name: "Second" });
    expect(second.status).toBe(201);
    const list = await request(app).get(ctx.base).set("Authorization", bearer(ctx.user));
    const own = list.body.voices.filter((voice: { kind: string }) => voice.kind === "own");
    expect(own.map((voice: { name: string }) => voice.name)).toEqual(["Second"]);
    expect(first.body.id).not.toBe(second.body.id);

    const removed = await request(app)
      .delete(`${ctx.base}/${second.body.id.slice(4)}`)
      .set("Authorization", bearer(ctx.user));
    expect(removed.status).toBe(204);
    const after = await request(app).get(ctx.base).set("Authorization", bearer(ctx.user));
    expect(after.body.selectedId).toBe(DEFAULT_VOICE_ID);
    expect(after.body.voices.some((voice: { kind: string }) => voice.kind === "own")).toBe(false);
    expect(eleven.state.deleted).toHaveLength(2);
  });

  it("keeps each user's voices private", async () => {
    const owner = await setup();
    const added = await addVoice(owner);
    const other = await setup();
    const id = added.body.id.slice(4);
    expect(
      (await request(app).delete(`${other.base}/${id}`).set("Authorization", bearer(other.user)))
        .status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put(`${other.base}/selected`)
          .set("Authorization", bearer(other.user))
          .send({ voiceId: added.body.id })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${other.base}/${encodeURIComponent(added.body.id)}/preview`)
          .set("Authorization", bearer(other.user))
      ).status,
    ).toBe(404);
  });
});

describe("hearing the code", () => {
  it("needs every word, in order, ignoring case and punctuation", () => {
    const code = ["amber", "river", "rocket", "zebra"];
    expect(heardCode("…and my code is Amber, river; rocket — zebra!", code)).toBe(true);
    expect(heardCode("my code is amber rocket river zebra", code)).toBe(false);
    expect(heardCode("my code is amber river rocket", code)).toBe(false);
  });
});
