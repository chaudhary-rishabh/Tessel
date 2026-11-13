import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { QUEUE_NAMES, VIDEO_POLL_MS, type VideoJobData } from "./jobs";

/** Where the API (and the worker, to check again) queues video checks. */
export interface MediaQueue {
  enqueueVideo(job: VideoJobData, delayMs?: number): Promise<void>;
}

export function createMediaQueue(connection: Redis): MediaQueue & { close(): Promise<void> } {
  const queue = new Queue(QUEUE_NAMES.media, { connection });
  return {
    async enqueueVideo(job, delayMs = VIDEO_POLL_MS) {
      await queue.add("video", job, {
        delay: delayMs,
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    },
    close: () => queue.close(),
  };
}
