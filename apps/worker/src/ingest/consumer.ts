import type { Logger } from "@tessel/logger";
import { ingestJobId, type IngestJobData } from "@tessel/queue";
import { parseDocumentKey, parseObjectCreatedEvents, type UploadEventQueue } from "@tessel/storage";

export interface IngestQueue {
  add(name: "ingest", data: IngestJobData, options: Record<string, unknown>): Promise<unknown>;
}

export const INGEST_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  // Finished jobs are removed so the same document can be queued again;
  // the outcome is kept on the document row.
  removeOnComplete: true,
  removeOnFail: true,
};

/**
 * Moves upload events from SQS onto the BullMQ ingest queue. A message is
 * deleted only after its jobs are queued, so a crash means redelivery, never
 * a lost upload. Messages that aren't document uploads are dropped.
 */
export async function handleUploadMessage(
  body: string,
  { bucket, queue, logger }: { bucket: string; queue: IngestQueue; logger: Logger },
): Promise<number> {
  let queued = 0;
  for (const event of parseObjectCreatedEvents(body)) {
    const target = event.bucket === bucket ? parseDocumentKey(event.key) : null;
    if (!target) {
      logger.debug(
        { key: event.key, bucket: event.bucket },
        "Ignoring an object that isn't a document upload",
      );
      continue;
    }
    await queue.add("ingest", target, {
      ...INGEST_JOB_OPTIONS,
      jobId: ingestJobId(target.documentId),
    });
    queued += 1;
  }
  return queued;
}

export interface UploadConsumer {
  stop(): Promise<void>;
  /** False when polling has been failing for a while. */
  isHealthy(): boolean;
}

const MAX_BACKOFF_MS = 30_000;
const UNHEALTHY_AFTER_MS = 90_000;

export function startUploadConsumer({
  uploads,
  bucket,
  queue,
  logger,
  waitSeconds = 20,
}: {
  uploads: UploadEventQueue;
  bucket: string;
  queue: IngestQueue;
  logger: Logger;
  waitSeconds?: number;
}): UploadConsumer {
  const controller = new AbortController();
  let lastSuccess = Date.now();
  let failures = 0;

  const loop = (async () => {
    while (!controller.signal.aborted) {
      try {
        const messages = await uploads.receive({ waitSeconds, signal: controller.signal });
        lastSuccess = Date.now();
        failures = 0;
        // An empty answer normally follows a full long poll; if it came back
        // early, pause briefly rather than spin.
        if (messages.length === 0) await new Promise((resolve) => setTimeout(resolve, 100));
        for (const message of messages) {
          try {
            const queued = await handleUploadMessage(message.body, { bucket, queue, logger });
            await uploads.delete(message.receiptHandle);
            if (queued > 0) logger.info({ queued }, "Queued uploaded documents for indexing");
          } catch (error) {
            // Left on the queue: SQS redelivers it, and moves it to the dead-letter queue after repeated failures.
            logger.error(
              { err: error, receiveCount: message.receiveCount },
              "Failed to queue an upload event",
            );
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        failures += 1;
        const delay = Math.min(1_000 * 2 ** (failures - 1), MAX_BACKOFF_MS);
        if (failures === 1 || failures % 10 === 0) {
          logger.error({ err: error, failures }, "Upload queue unreachable, retrying");
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  })();

  return {
    async stop() {
      controller.abort();
      await loop;
    },
    isHealthy: () => Date.now() - lastSuccess < UNHEALTHY_AFTER_MS,
  };
}
