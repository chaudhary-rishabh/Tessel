import { execFileSync } from "node:child_process";
import {
  aiEnvSchema,
  createAi,
  createSpendGuard,
  createTranscriber,
  loadModelRegistry,
  memorySpendStore,
  memoryVectorIndex,
} from "@tessel/ai";
import { memoryLedger, startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { DocumentRow } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import { storageKeys } from "@tessel/storage";
import { memoryObjectStore } from "@tessel/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestDocument } from "./ingest";
import type { DocumentStore } from "./store";
import { formatTimestamp, speechAudio, transcriptText } from "./transcribe";

const logger = createLogger("worker-test", { level: "silent", pretty: false });
const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

/** A second of a tone, as a WAV file. */
function toneWav(seconds = 1, rate = 8000): Buffer {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

describe("transcripts", () => {
  it("formats times", () => {
    expect(formatTimestamp(5)).toBe("0:05");
    expect(formatTimestamp(65.9)).toBe("1:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("groups segments into timed paragraphs of about a minute", () => {
    const text = transcriptText({
      text: "",
      durationSeconds: 140,
      segments: [
        { text: "Hello.", startSecond: 0, endSecond: 2 },
        { text: "Agenda first.", startSecond: 20, endSecond: 24 },
        { text: "Launch moves.", startSecond: 65, endSecond: 70 },
        { text: "Thanks all.", startSecond: 130, endSecond: 140 },
      ],
    });
    expect(text).toBe("[0:00] Hello. Agenda first.\n\n[1:05] Launch moves.\n\n[2:10] Thanks all.");
  });

  it.skipIf(!hasFfmpeg)("turns a recording into small mono speech audio", async () => {
    const { audio, converted } = await speechAudio(toneWav(2));
    expect(converted).toBe(true);
    // An MP3 starts with an ID3 tag or a frame sync.
    expect(audio.subarray(0, 3).toString("latin1") === "ID3" || audio[0] === 0xff).toBe(true);
  });

  it("sends a file ffmpeg can't read as it is", async () => {
    const bytes = Buffer.from("not really audio");
    const { audio, converted } = await speechAudio(bytes);
    expect(converted).toBe(false);
    expect(audio.equals(bytes)).toBe(true);
  });
});

describe("ingesting recordings", () => {
  function setup(transcribe = true) {
    const ledger = memoryLedger();
    const ai = createAi({
      gateway: { apiKey: "test", baseURL: gateway.url },
      registry: loadModelRegistry(),
      spend: createSpendGuard({
        store: memorySpendStore(),
        limits: { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
        logger,
      }),
      ledger,
      moderation: { mode: "off", failure: "allow" },
      logger,
      timeoutMs: 5_000,
    });
    const transcriber = transcribe
      ? createTranscriber(
          aiEnvSchema.parse({
            AI_GATEWAY_API_KEY: "test",
            AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
          }),
        )
      : undefined;
    const changes: { status: string; errorCode?: string }[] = [];
    const row = {
      id: documentId,
      workspaceId,
      userId,
      filename: "standup.wav",
      mediaType: "audio/wav",
      sizeBytes: 0,
      storageKey: storageKeys.documentOriginal(workspaceId, documentId),
      status: "queued",
    } as DocumentRow;
    const store: DocumentStore = {
      uploaderOf: async () => userId,
      start: async () => {
        changes.push({ status: "processing" });
        return row;
      },
      finish: async () => {
        changes.push({ status: "ready" });
        return true;
      },
      fail: async (_user, _doc, errorCode) => void changes.push({ status: "failed", errorCode }),
    };
    return {
      deps: {
        store,
        objects: memoryObjectStore(),
        index: memoryVectorIndex(),
        ai,
        logger,
        transcriber,
      },
      ledger,
      changes,
    };
  }

  it("transcribes a recording into timed, searchable text and records the cost", async () => {
    const { deps, ledger, changes } = setup();
    await deps.objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      toneWav(),
      "audio/wav",
    );

    const outcome = await ingestDocument(
      deps,
      { workspaceId, documentId },
      { isLastAttempt: false },
    );
    expect(outcome).toBe("ready");
    expect(changes.map((change) => change.status)).toEqual(["processing", "ready"]);
    const text = (
      await deps.objects.get(storageKeys.documentText(workspaceId, documentId))
    ).toString();
    expect(text).toContain("[0:00] Welcome to the weekly product review.");
    expect(text).toContain("[1:15] Priya owns the release notes, due Friday.");
    expect(
      [...deps.index.points.values()].some((point) => point.payload.text.includes("May 14th")),
    ).toBe(true);
    expect(ledger.events).toContainEqual(
      expect.objectContaining({
        feature: "transcription",
        modelId: "elevenlabs/scribe-v2",
        status: "ok",
      }),
    );
    const sent = gateway.requests
      .filter((entry) => entry.path.endsWith("/transcription-model"))
      .at(-1)!;
    expect(sent.headers["ai-model-id"]).toBe("elevenlabs/scribe-v2");
    if (hasFfmpeg) expect((sent.body as { mediaType?: string }).mediaType).toBe("audio/mpeg");
  });

  it("fails a recording when transcription isn't set up or fails", async () => {
    const off = setup(false);
    await off.deps.objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      toneWav(),
      "audio/wav",
    );
    expect(
      await ingestDocument(off.deps, { workspaceId, documentId }, { isLastAttempt: false }),
    ).toBe("failed");
    expect(off.changes.at(-1)).toEqual({
      status: "failed",
      errorCode: "transcription_unavailable",
    });

    const broken = setup();
    await broken.deps.objects.put(
      storageKeys.documentOriginal(workspaceId, documentId),
      Buffer.from("MOCK_TRANSCRIBE_FAIL"),
      "audio/wav",
    );
    expect(
      await ingestDocument(broken.deps, { workspaceId, documentId }, { isLastAttempt: false }),
    ).toBe("failed");
    expect(broken.changes.at(-1)).toEqual({ status: "failed", errorCode: "transcription_failed" });
  });
});
