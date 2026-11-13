import type { Ai, VideoGenerator } from "@tessel/ai";
import { media, withUserContext, type Database, type MediaRow } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { VIDEO_TIMEOUT_MS, type MediaQueue, type VideoJobData } from "@tessel/queue";
import { storageKeys, type ObjectStore } from "@tessel/storage";
import { and, eq } from "drizzle-orm";

type VideoPatch = Partial<
  Pick<
    MediaRow,
    "status" | "progress" | "error" | "storageKey" | "sizeBytes" | "mediaType" | "costNanoUsd"
  >
>;

/** The rows video jobs read and update, as the user who owns them. */
export interface VideoStore {
  get(job: VideoJobData): Promise<MediaRow | undefined>;
  update(job: VideoJobData, patch: VideoPatch): Promise<void>;
}

export function createVideoStore(db: Database): VideoStore {
  const where = (job: VideoJobData) =>
    and(
      eq(media.id, job.mediaId),
      eq(media.workspaceId, job.workspaceId),
      eq(media.userId, job.userId),
    );
  return {
    async get(job) {
      const [row] = await withUserContext(db, job.userId, (tx) =>
        tx.select().from(media).where(where(job)),
      );
      return row;
    },
    async update(job, patch) {
      await withUserContext(db, job.userId, (tx) => tx.update(media).set(patch).where(where(job)));
    },
  };
}

export interface VideoJobDeps {
  store: VideoStore;
  objects: ObjectStore;
  videos: VideoGenerator | undefined;
  ai: Pick<Ai, "tracker">;
  queue: MediaQueue;
  logger: Logger;
  /** How long to wait before checking again. */
  pollMs: number;
  /** Fetches a finished video the provider gives as a URL. */
  download?: (url: string) => Promise<Buffer>;
  now?: () => Date;
}

/** Most videos take a minute or two; progress eases toward this without reaching it. */
const TYPICAL_MS = 90_000;

/** An estimate of how far along a video is, since providers don't say. */
export function estimatedProgress(elapsedMs: number): number {
  return Math.min(95, Math.round(95 * (1 - Math.exp(-elapsedMs / TYPICAL_MS))));
}

async function fetchVideo(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Downloading the video failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Checks one video being made. While it isn't done, its progress is updated
 * and the check is queued again; once it's done, the clip is saved and the
 * cost recorded; if it failed or took too long, it's marked failed.
 */
export async function processVideoJob(
  deps: VideoJobDeps,
  job: VideoJobData,
): Promise<"pending" | "ready" | "failed" | "skipped"> {
  const { store, objects, videos, ai, queue, logger } = deps;
  const row = await store.get(job);
  if (!row || row.kind !== "video" || row.status !== "pending") return "skipped";

  const record = (status: "ok" | "error", costNanoUsd: number, errorCode: string | null) =>
    ai.tracker.record({
      workspaceId: job.workspaceId,
      userId: job.userId,
      requestId: null,
      feature: "video",
      route: "gateway",
      modelId: row.modelId,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimated: false,
      status,
      errorCode,
      costNanoUsd,
      latencyMs: Date.now() - row.createdAt.getTime(),
    });
  const fail = async (error: string) => {
    await store.update(job, { status: "failed", error });
    await record("error", 0, "video_failed");
    return "failed" as const;
  };

  if (!videos || row.operation === null || row.operation === undefined) {
    return fail("Video generation isn't set up.");
  }
  const elapsed = (deps.now?.() ?? new Date()).getTime() - row.createdAt.getTime();
  if (elapsed > VIDEO_TIMEOUT_MS) return fail("The video took too long to make. Try again.");

  const status = await videos.status(row.operation as never);
  if (status.status === "pending") {
    await store.update(job, { progress: estimatedProgress(elapsed) });
    await queue.enqueueVideo(job, deps.pollMs);
    return "pending";
  }
  if (status.status === "error") {
    logger.warn({ mediaId: job.mediaId, error: status.error }, "A video failed");
    return fail(status.error || "The video couldn't be made.");
  }

  const bytes =
    "data" in status.video
      ? Buffer.from(status.video.data)
      : await (deps.download ?? fetchVideo)(status.video.url);
  const storageKey = storageKeys.mediaOriginal(job.workspaceId, job.mediaId);
  await objects.put(storageKey, bytes, status.video.mediaType);
  const costNanoUsd = videos.costNanoUsd((row.durationMs ?? 0) / 1000);
  await store.update(job, {
    status: "ready",
    progress: 100,
    storageKey,
    sizeBytes: bytes.length,
    mediaType: status.video.mediaType,
    costNanoUsd,
  });
  await record("ok", costNanoUsd, null);
  return "ready";
}
