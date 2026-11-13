import { randomUUID } from "node:crypto";
import { ReadableStream } from "node:stream/web";
import { voice } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import {
  createLiveModelRegistry,
  createSpendGuard,
  createUsageTracker,
  memorySpendStore,
  readModelsConfig,
} from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import { createDatabase, createUsageLedger, type DatabaseConnection } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import {
  Experimental_MockStreamingSpeechModelV4 as MockSpeechModel,
  MockTranscriptionModelV4,
} from "ai/test";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { envSchema } from "../src/env";
import type { VoiceRuntime } from "../src/runtime";
import { runVoiceSession, SPEND_LIMIT_MESSAGE } from "../src/session";
import { GatewaySTT } from "../src/speech/gateway-stt";
import { gatewayTTS, TTS_SAMPLE_RATE } from "../src/speech/gateway-tts";
import { createMockSpeech, MOCK_TRANSCRIPT } from "../src/speech/mock";
import type { SpeechProviders } from "../src/speech/providers";
import { createVoiceStore } from "../src/store";

const QUESTION = "What's the capital of France?";
const ANSWER = "Paris is the capital of France.";
const MODEL = "google/gemini-3.5-flash-lite";

/** The user's microphone: silent 20 ms frames, pushed in real time. */
class Microphone extends voice.AudioInput {
  #controller!: ReadableStreamDefaultController<AudioFrame>;
  #timer: NodeJS.Timeout | undefined;

  constructor() {
    super();
    this.multiStream.addInputStream(
      new ReadableStream<AudioFrame>({
        start: (controller) => {
          this.#controller = controller;
        },
      }) as unknown as globalThis.ReadableStream<AudioFrame>,
    );
  }

  start() {
    const samples = 320; // 20 ms at 16 kHz
    this.#timer = setInterval(() => {
      this.#controller.enqueue(new AudioFrame(new Int16Array(samples), 16_000, 1, samples));
    }, 20);
  }

  stop() {
    clearInterval(this.#timer);
  }
}

/** The user's speaker: keeps what the agent says and reports it played instantly. */
class Speaker extends voice.AudioOutput {
  frames = 0;
  #segmentSeconds = 0;
  #started = false;

  constructor() {
    super(TTS_SAMPLE_RATE);
  }

  override async captureFrame(frame: AudioFrame): Promise<void> {
    await super.captureFrame(frame);
    this.frames += 1;
    this.#segmentSeconds += frame.samplesPerChannel / frame.sampleRate;
    if (!this.#started) {
      this.#started = true;
      this.onPlaybackStarted(Date.now());
    }
  }

  override flush(): void {
    super.flush();
    this.#finish(false);
  }

  clearBuffer(): void {
    this.#finish(true);
  }

  #finish(interrupted: boolean) {
    if (!this.#started) return;
    const playbackPosition = this.#segmentSeconds;
    this.#started = false;
    this.#segmentSeconds = 0;
    setTimeout(() => this.onPlaybackFinished({ playbackPosition, interrupted }), 10);
  }
}

/**
 * Speech through the real gateway STT and TTS classes, over scripted models:
 * the transcriber hears the question after half a second of audio, and the
 * speech model answers each sentence with a fifth of a second of audio.
 */
function scriptedSpeech(): SpeechProviders & { spoken: string[] } {
  const spoken: string[] = [];
  const transcriber = new MockTranscriptionModelV4({
    modelId: "mock-stt",
    doStream: async ({ audio }) => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          const reader = audio.getReader();
          let bytes = 0;
          let heard = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += typeof value === "string" ? 0 : value.byteLength;
            if (!heard && bytes >= 16_000) {
              heard = true; // half a second of 16-bit audio at 16 kHz
              controller.enqueue({ type: "transcript-partial", text: "What's the" });
              controller.enqueue({
                type: "transcript-final",
                text: QUESTION,
                startSecond: 0,
                endSecond: 0.5,
              });
            }
          }
          controller.enqueue({ type: "finish", text: QUESTION, segments: [] });
          controller.close();
        },
      }) as unknown as globalThis.ReadableStream<never>,
    }),
  });
  const speaker = new MockSpeechModel({
    modelId: "mock-tts",
    doStream: async ({ text }) => ({
      stream: new ReadableStream({
        async start(controller) {
          let said = "";
          const reader = text.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            said += value.text;
          }
          spoken.push(said.trim());
          controller.enqueue({ type: "stream-start", warnings: [] });
          const bytes = new Uint8Array((TTS_SAMPLE_RATE / 5) * 2);
          controller.enqueue({
            type: "audio",
            audio: bytes,
            audioFormat: { type: "audio/pcm", rate: TTS_SAMPLE_RATE },
          });
          controller.enqueue({ type: "finish" });
          controller.close();
        },
      }) as unknown as globalThis.ReadableStream<never>,
    }),
  });
  return {
    spoken,
    provider: "gateway",
    stt: new GatewaySTT({ model: transcriber, modelId: "elevenlabs/scribe-v2-realtime" }),
    tts: gatewayTTS({ model: speaker, modelId: "elevenlabs/eleven-flash-v2.5", voiceId: "v" }),
    sttModelId: "elevenlabs/scribe-v2-realtime",
    ttsModelId: "elevenlabs/eleven-flash-v2.5",
    voiceId: "v",
  };
}

let gateway: MockGateway;
let app: DatabaseConnection;
let owner: pg.Pool;
const enqueued: unknown[] = [];

beforeAll(async () => {
  gateway = await startMockGateway();
  app = createDatabase({ url: inject("testDatabaseUrl"), maxConnections: 3 });
  owner = new pg.Pool({ connectionString: inject("testDatabaseOwnerUrl"), max: 2 });
});

afterAll(async () => {
  await gateway.close();
  await app.close();
  await owner.end();
});

function runtimeWith(spendLimitUsd = 100): VoiceRuntime {
  const env = envSchema.parse({
    NODE_ENV: "test",
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "devkey",
    LIVEKIT_API_SECRET: "secret",
    DATABASE_URL: "postgres://unused@localhost/unused",
    REDIS_CACHE_URL: "redis://localhost:6379",
    REDIS_QUEUE_URL: "redis://localhost:6379",
    AI_GATEWAY_URL: gateway.url,
    AI_GATEWAY_API_KEY: "test-key",
    VOICE_ENDPOINTING_MIN_MS: "100",
    VOICE_ENDPOINTING_MAX_MS: "500",
  });
  const logger = createLogger("voice-test", { level: "silent", pretty: false });
  const ledger = createUsageLedger(app.db);
  const spend = createSpendGuard({
    store: memorySpendStore(),
    limits: {
      userDailyUsd: spendLimitUsd,
      workspaceDailyUsd: spendLimitUsd,
      globalDailyUsd: spendLimitUsd,
    },
    logger,
  });
  return {
    env,
    logger,
    store: createVoiceStore(app.db),
    registry: createLiveModelRegistry(readModelsConfig()),
    spend,
    tracker: createUsageTracker({ ledger, spend, logger }),
    memory: {
      enqueue: async (job) => {
        enqueued.push(job);
      },
    },
  };
}

/** What the API creates before the agent joins: a user, their workspace, a chat, a session. */
async function seedSession() {
  const id = randomUUID();
  const { rows: users } = await owner.query<{ id: string }>(
    "insert into users (email, name) values ($1, 'Ada') returning id",
    [`${id}@example.com`],
  );
  const userId = users[0]!.id;
  const { rows: workspaces } = await owner.query<{ id: string }>(
    "insert into workspaces (name, owner_id, is_personal) values ('Ada', $1, true) returning id",
    [userId],
  );
  const workspaceId = workspaces[0]!.id;
  await owner.query(
    "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
    [workspaceId, userId],
  );
  const { rows: threads } = await owner.query<{ id: string }>(
    "insert into threads (workspace_id, user_id, model_id) values ($1, $2, $3) returning id",
    [workspaceId, userId, MODEL],
  );
  const threadId = threads[0]!.id;
  await owner.query(
    `insert into voice_sessions (id, workspace_id, user_id, thread_id, room_name, model_id, status)
     values ($1, $2, $3, $4, $5, $6, 'starting')`,
    [id, workspaceId, userId, threadId, `voice-${id}`, MODEL],
  );
  return { sessionId: id, userId, workspaceId, threadId };
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 10_000) {
  const until = Date.now() + ms;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

const job = (sessionId: string) => ({
  job: { metadata: JSON.stringify({ voiceSessionId: sessionId }) },
  connect: async () => undefined,
  shutdown: () => undefined,
});

describe("a voice conversation", () => {
  it("hears the user, answers through the gateway, speaks, and saves it all", async () => {
    const seeded = await seedSession();
    gateway.reset();
    gateway.enqueue({ text: ANSWER, usage: { promptTokens: 400, completionTokens: 12 } });
    const speech = scriptedSpeech();
    const microphone = new Microphone();
    const speaker = new Speaker();

    const session = await runVoiceSession(job(seeded.sessionId), runtimeWith(), {
      speech,
      turnDetection: "stt",
      io: { input: microphone, output: speaker },
    });
    expect(session).toBeDefined();
    microphone.start();

    const saved = await eventually(
      async () =>
        (
          await owner.query<{ role: string; content: string; voice_session_id: string }>(
            "select role, content, voice_session_id from messages where thread_id = $1 order by created_at",
            [seeded.threadId],
          )
        ).rows,
      (rows) => rows.length >= 2,
    );
    microphone.stop();
    expect(saved).toEqual([
      { role: "user", content: QUESTION, voice_session_id: seeded.sessionId },
      { role: "assistant", content: ANSWER, voice_session_id: seeded.sessionId },
    ]);
    expect(speech.spoken.join(" ")).toBe(ANSWER);
    expect(speaker.frames).toBeGreaterThan(0);

    // The model call went through the gateway with caching on and the history and prompt in it.
    const call = gateway.requests.find((request) => request.path.endsWith("/chat/completions"));
    expect(call?.body).toMatchObject({
      model: MODEL,
      stream: true,
      providerOptions: { gateway: { caching: "auto" } },
    });
    expect(JSON.stringify(call?.body.messages)).toContain("Their name is Ada.");

    // A timing row for the reply, and usage for the model and the speech.
    const turns = await eventually(
      async () =>
        (
          await owner.query<{ total_ms: number; end_of_turn_ms: number }>(
            "select total_ms, end_of_turn_ms from voice_turns where session_id = $1",
            [seeded.sessionId],
          )
        ).rows,
      (rows) => rows.length > 0,
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.total_ms).toBeGreaterThan(0);

    const usage = await eventually(
      async () =>
        (
          await owner.query<{ model_id: string; cost_nano_usd: string }>(
            "select model_id, cost_nano_usd from usage_events where request_id = $1 and feature = 'voice'",
            [seeded.sessionId],
          )
        ).rows,
      (rows) => rows.some((row) => row.model_id === "elevenlabs/eleven-flash-v2.5"),
    );
    const models = usage.map((row) => row.model_id);
    expect(models).toContain(MODEL);
    expect(models).toContain("elevenlabs/eleven-flash-v2.5");

    // The chat is named after the question, and the session is live with its speech settings.
    const { rows: threadRows } = await owner.query<{ title: string }>(
      "select title from threads where id = $1",
      [seeded.threadId],
    );
    expect(threadRows[0]!.title).toBe(QUESTION);

    await session!.close();
    const ended = await eventually(
      async () =>
        (
          await owner.query<{
            status: string;
            end_reason: string | null;
            turns: number;
            latency_p50_ms: number | null;
            speech_provider: string;
          }>(
            "select status, end_reason, turns, latency_p50_ms, speech_provider from voice_sessions where id = $1",
            [seeded.sessionId],
          )
        ).rows[0]!,
      (row) => row.status === "ended",
    );
    expect(ended).toMatchObject({ status: "ended", turns: 1, speech_provider: "gateway" });
    expect(ended.latency_p50_ms).toBe(turns[0]!.total_ms);
    expect(enqueued).toContainEqual({
      workspaceId: seeded.workspaceId,
      userId: seeded.userId,
      threadId: seeded.threadId,
    });
  });

  it("tells a user over today's limit, and ends the call", async () => {
    const seeded = await seedSession();
    gateway.reset();
    const speech = scriptedSpeech();
    const microphone = new Microphone();
    // A one-microdollar cap, already spent: the first reply is over it.
    const runtime = runtimeWith(0.000_001);
    await runtime.spend.add({ workspaceId: seeded.workspaceId, userId: seeded.userId }, 10_000);
    const session = await runVoiceSession(job(seeded.sessionId), runtime, {
      speech,
      turnDetection: "stt",
      io: { input: microphone, output: new Speaker() },
    });
    microphone.start();
    const ended = await eventually(
      async () =>
        (
          await owner.query<{ status: string; end_reason: string | null }>(
            "select status, end_reason from voice_sessions where id = $1",
            [seeded.sessionId],
          )
        ).rows[0]!,
      (row) => row.status === "ended",
    );
    microphone.stop();
    await session?.close();
    expect(ended).toEqual({ status: "ended", end_reason: "spend_limit" });
    expect(speech.spoken.join(" ")).toBe(SPEND_LIMIT_MESSAGE);
    expect(gateway.requests.filter((r) => r.path.endsWith("/chat/completions"))).toHaveLength(0);
  });

  it("runs on the offline mock speech, as development and browser tests do", async () => {
    const seeded = await seedSession();
    gateway.reset();
    const microphone = new Microphone();
    const speaker = new Speaker();
    const session = await runVoiceSession(job(seeded.sessionId), runtimeWith(), {
      speech: createMockSpeech(),
      turnDetection: "stt",
      io: { input: microphone, output: speaker },
    });
    microphone.start();
    const saved = await eventually(
      async () =>
        (
          await owner.query<{ role: string; content: string }>(
            "select role, content from messages where thread_id = $1 order by created_at",
            [seeded.threadId],
          )
        ).rows,
      (rows) => rows.length >= 2,
    );
    microphone.stop();
    await session?.close();
    expect(saved).toEqual([
      { role: "user", content: MOCK_TRANSCRIPT },
      { role: "assistant", content: `Echo: ${MOCK_TRANSCRIPT}` },
    ]);
    expect(speaker.frames).toBeGreaterThan(0);
  });

  it("leaves a session that already ended", async () => {
    const seeded = await seedSession();
    await owner.query("update voice_sessions set status = 'ended' where id = $1", [
      seeded.sessionId,
    ]);
    let reason: string | undefined;
    const session = await runVoiceSession(
      { ...job(seeded.sessionId), shutdown: (why?: string) => void (reason = why) },
      runtimeWith(),
      { speech: scriptedSpeech(), io: { input: new Microphone(), output: new Speaker() } },
    );
    expect(session).toBeUndefined();
    expect(reason).toBe("session_not_open");
  });
});
