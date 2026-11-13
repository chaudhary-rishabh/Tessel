import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { VOICE_AGENT_NAME, voiceDispatchMetadataSchema } from "@tessel/contracts";
import { threads, voiceSessions } from "@tessel/db";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import { TokenVerifier } from "livekit-server-sdk";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createLiveKitRooms, type VoiceRooms } from "../src/modules/voice/livekit";
import { bearer, connect, createTestAi, createTestApp, signUp } from "./helpers";

const LIVEKIT = {
  url: "http://livekit.invalid:7880",
  publicUrl: "wss://rtc.example.com",
  apiKey: "test-livekit-key",
  apiSecret: "test-livekit-secret-that-is-long-enough-for-hs256",
};

/** Real tokens, but rooms are only recorded as closed (there is no LiveKit server in tests). */
function recordingRooms(): VoiceRooms & { closed: string[] } {
  const real = createLiveKitRooms(LIVEKIT);
  const closed: string[] = [];
  return {
    publicUrl: real.publicUrl,
    issueToken: (input) => real.issueToken(input),
    closeRoom: async (roomName) => {
      closed.push(roomName);
    },
    closed,
  };
}

let gateway: MockGateway;
let app: Express;
const rooms = recordingRooms();
const ownerDb = () => connect(inject("testDatabaseOwnerUrl")).db;

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createTestApp({
    ai: createTestAi({ gatewayUrl: gateway.url, moderation: { mode: "off", failure: "allow" } }),
    voice: { rooms, maxSessionMinutes: 20 },
  });
});
afterAll(() => gateway.close());

async function setup() {
  const user = await signUp(app);
  const workspaces = await request(app).get("/workspaces").set("Authorization", bearer(user));
  const workspaceId = workspaces.body.workspaces[0].id as string;
  return { user, workspaceId, base: `/workspaces/${workspaceId}/voice` };
}

describe("voice sessions", () => {
  it("says voice is available when LiveKit is set up", async () => {
    const { user, base } = await setup();
    const res = await request(app).get(`${base}/status`).set("Authorization", bearer(user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true });
  });

  it("starts a conversation in a new chat with a token for one room and the agent", async () => {
    const { user, workspaceId, base } = await setup();
    const res = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      url: LIVEKIT.publicUrl,
      modelId: "google/gemini-3.5-flash-lite",
      maxDurationSeconds: 20 * 60,
    });

    // The token lets this user into this room only, and dispatches the voice agent with the session.
    const claims = await new TokenVerifier(LIVEKIT.apiKey, LIVEKIT.apiSecret).verify(
      res.body.token,
    );
    const roomName = `voice-${res.body.sessionId}`;
    expect(claims.sub).toBe(`user-${user.auth.user.id}`);
    expect(claims.video).toMatchObject({
      room: roomName,
      roomJoin: true,
      canPublishSources: ["microphone"],
    });
    const config = claims.roomConfig as unknown as {
      maxParticipants: number;
      agents: { agentName: string; metadata: string }[];
    };
    expect(config.maxParticipants).toBe(2);
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]!.agentName).toBe(VOICE_AGENT_NAME);
    expect(voiceDispatchMetadataSchema.parse(JSON.parse(config.agents[0]!.metadata))).toEqual({
      voiceSessionId: res.body.sessionId,
    });

    const [session] = await ownerDb()
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.id, res.body.sessionId));
    expect(session).toMatchObject({
      workspaceId,
      userId: user.auth.user.id,
      threadId: res.body.threadId,
      roomName,
      status: "starting",
    });
    const [thread] = await ownerDb()
      .select()
      .from(threads)
      .where(eq(threads.id, res.body.threadId));
    expect(thread?.userId).toBe(user.auth.user.id);
  });

  it("continues an existing chat and uses a model from the picker", async () => {
    const { user, base } = await setup();
    const first = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({});
    const res = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({ threadId: first.body.threadId, model: "openai/gpt-5.4-mini" });
    expect(res.status).toBe(201);
    expect(res.body.threadId).toBe(first.body.threadId);
    expect(res.body.modelId).toBe("openai/gpt-5.4-mini");
  });

  it("ends the user's last conversation when a new one starts", async () => {
    const { user, base } = await setup();
    const first = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({});
    await request(app).post(`${base}/sessions`).set("Authorization", bearer(user)).send({});

    const [old] = await ownerDb()
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.id, first.body.sessionId));
    expect(old).toMatchObject({ status: "ended", endReason: "replaced" });
    expect(rooms.closed).toContain(`voice-${first.body.sessionId}`);
  });

  it("ends a conversation from the browser, once", async () => {
    const { user, base } = await setup();
    const started = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({});
    const end = () =>
      request(app)
        .post(`${base}/sessions/${started.body.sessionId}/end`)
        .set("Authorization", bearer(user));
    expect((await end()).status).toBe(204);
    expect((await end()).status).toBe(204);

    const [session] = await ownerDb()
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.id, started.body.sessionId));
    expect(session).toMatchObject({ status: "ended", endReason: "user_ended" });
  });

  it("keeps sessions and chats private to their owner", async () => {
    const owner = await setup();
    const started = await request(app)
      .post(`${owner.base}/sessions`)
      .set("Authorization", bearer(owner.user))
      .send({});

    const other = await setup();
    // Someone else's chat can't be continued, even naming its ID.
    const continued = await request(app)
      .post(`${other.base}/sessions`)
      .set("Authorization", bearer(other.user))
      .send({ threadId: started.body.threadId });
    expect(continued.status).toBe(404);
    // Nor can their session be ended, or their workspace used.
    const ended = await request(app)
      .post(`${other.base}/sessions/${started.body.sessionId}/end`)
      .set("Authorization", bearer(other.user));
    expect(ended.status).toBe(404);
    const wrongWorkspace = await request(app)
      .post(`${owner.base}/sessions`)
      .set("Authorization", bearer(other.user))
      .send({});
    expect(wrongWorkspace.status).toBe(404);
  });

  it("refuses models that aren't in the picker", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({ model: "openai/text-embedding-3-small" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("model_not_found");
  });

  it("applies the plan's model tiers", async () => {
    const { user, base } = await setup();
    const res = await request(app)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({ model: "anthropic/claude-opus-5.5" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("model_requires_plan");
  });

  it("answers 503 when voice isn't set up", async () => {
    const offApp = createTestApp({ voice: { maxSessionMinutes: 30 } });
    const user = await signUp(offApp);
    const workspaces = await request(offApp).get("/workspaces").set("Authorization", bearer(user));
    const base = `/workspaces/${workspaces.body.workspaces[0].id}/voice`;
    const status = await request(offApp).get(`${base}/status`).set("Authorization", bearer(user));
    expect(status.body).toEqual({ available: false });
    const res = await request(offApp)
      .post(`${base}/sessions`)
      .set("Authorization", bearer(user))
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("voice_unavailable");
  });
});
