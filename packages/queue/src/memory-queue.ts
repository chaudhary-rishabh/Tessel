import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { MEMORY_JOB_DELAY_MS, memoryJobId, QUEUE_NAMES, type ThreadMemoryJobData } from "./jobs";

/**
 * Queues memory work for a chat. A job already waiting for the chat absorbs
 * new requests (same job ID), so a burst of replies is processed once.
 */
export function createMemoryQueue(connection: Redis) {
  const queue = new Queue(QUEUE_NAMES.memory, { connection });
  return {
    async enqueue(job: ThreadMemoryJobData): Promise<void> {
      await queue.add("thread", job, {
        jobId: memoryJobId(job.threadId),
        delay: MEMORY_JOB_DELAY_MS,
        attempts: 2,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: true,
        // A kept failed job would hold its ID and swallow later work for the chat.
        removeOnFail: true,
      });
    },
    close: () => queue.close(),
  };
}
