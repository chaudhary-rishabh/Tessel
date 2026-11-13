import { aiEnvSchema, createVideoGenerator, type UsageEvent } from "@tessel/ai";
import { startMockGateway, type MockGateway } from "@tessel/ai/testing";
import type { MediaRow } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import type { VideoJobData } from "@tessel/queue";
import { storageKeys } from "@tessel/storage";
import { memoryObjectStore } from "@tessel/storage/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { estimatedProgress, processVideoJob, type VideoStore } from "./video";

const logger = createLogger("worker-test", { level: "silent", pretty: false });
const job: VideoJobData = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  userId: "33333333-3333-4333-8333-333333333333",
  mediaId: "44444444-4444-4444-8444-444444444444",
};

let gateway: MockGateway;
beforeAll(async () => {
  gateway = await startMockGateway();
});
afterAll(() => gateway.close());

function setup(prompt: string, createdAt = new Date()) {
  const videos = createVideoGenerator(
    aiEnvSchema.parse({
      AI_GATEWAY_API_KEY: "test",
      AI_GATEWAY_SDK_URL: gateway.url.replace(/\/v1$/, "/v3/ai"),
    }),
  )!;
  let row: MediaRow | undefined;
  const store: VideoStore = {
    get: async () => row,
    update: async (_job, patch) => {
      row = { ...row!, ...patch };
    },
  };
  const queued: number[] = [];
  const recorded: UsageEvent[] = [];
  const objects = memoryObjectStore();
  const deps = {
    store,
    objects,
    videos,
    ai: { tracker: { record: async (event: UsageEvent) => void recorded.push(event) } },
    queue: { enqueueVideo: async (_job: VideoJobData, delay?: number) => void queued.push(delay!) },
    logger,
    pollMs: 10,
  };
  return {
    deps,
    objects,
    queued,
    recorded,
    row: () => row!,
    async start() {
      const { operation } = await videos.start({ prompt, aspectRatio: "16:9", durationSeconds: 8 });
      row = {
        id: job.mediaId,
        workspaceId: job.workspaceId,
        userId: job.userId,
        threadId: null,
        kind: "video",
        status: "pending",
        prompt,
        modelId: videos.modelId,
        sourceIds: [],
        mediaType: "video/mp4",
        width: 1280,
        height: 720,
        durationMs: 8000,
        sizeBytes: null,
        storageKey: null,
        previewKey: null,
        operation,
        progress: 0,
        error: null,
        costNanoUsd: 0,
        createdAt,
        updatedAt: createdAt,
      };
    },
  };
}

describe("processVideoJob", () => {
  it("checks until the video is done, then saves it and records the cost", async () => {
    const t = setup("Waves at dusk", new Date(Date.now() - 30_000));
    await t.start();

    expect(await processVideoJob(t.deps, job)).toBe("pending");
    expect(t.row().progress).toBeGreaterThan(0);
    expect(t.queued).toEqual([10]);
    expect(await processVideoJob(t.deps, job)).toBe("pending");

    expect(await processVideoJob(t.deps, job)).toBe("ready");
    expect(t.row()).toMatchObject({
      status: "ready",
      progress: 100,
      mediaType: "video/mp4",
      storageKey: storageKeys.mediaOriginal(job.workspaceId, job.mediaId),
      costNanoUsd: 1_200_000_000,
    });
    const saved = await t.objects.get(storageKeys.mediaOriginal(job.workspaceId, job.mediaId));
    expect(saved.subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(t.recorded).toEqual([
      expect.objectContaining({ feature: "video", status: "ok", costNanoUsd: 1_200_000_000 }),
    ]);
    // A check that arrives after it's done does nothing.
    expect(await processVideoJob(t.deps, job)).toBe("skipped");
  });

  it("marks a video failed when the model fails", async () => {
    const t = setup("MOCK_VIDEO_FAIL");
    await t.start();
    await processVideoJob(t.deps, job);
    await processVideoJob(t.deps, job);
    expect(await processVideoJob(t.deps, job)).toBe("failed");
    expect(t.row()).toMatchObject({ status: "failed", error: "The mock video model declined." });
    expect(t.recorded[0]).toMatchObject({ status: "error", costNanoUsd: 0 });
  });

  it("gives up on a video that takes too long", async () => {
    const t = setup("Slow", new Date(Date.now() - 20 * 60_000));
    await t.start();
    expect(await processVideoJob(t.deps, job)).toBe("failed");
    expect(t.row().error).toMatch(/took too long/);
  });

  it("estimates progress without reaching the end", () => {
    expect(estimatedProgress(0)).toBe(0);
    expect(estimatedProgress(90_000)).toBeGreaterThan(50);
    expect(estimatedProgress(10 * 60_000)).toBe(95);
  });
});
