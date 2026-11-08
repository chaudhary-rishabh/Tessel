import {
  aiOptionsFromEnv,
  createAi,
  createQdrantIndex,
  createSpendGuard,
  redisSpendStore,
  spendLimitsFromEnv,
} from "@tessel/ai";
import { loadEnvFiles, parseEnv } from "@tessel/config/env";
import { createDatabase, createUsageLedger } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import { createQueueConnection, jobSchemas, QUEUE_NAMES } from "@tessel/queue";
import { createS3ObjectStore, createSqsUploadQueue } from "@tessel/storage";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { envSchema } from "./env";
import { startHealthServer } from "./health";
import { startUploadConsumer } from "./ingest/consumer";
import { ingestDocument } from "./ingest/ingest";
import { createDocumentStore } from "./ingest/store";
import { processSystemJob } from "./processors/system";

const SERVICE = "worker";
const SHUTDOWN_TIMEOUT_MS = 30_000;

loadEnvFiles();
const env = parseEnv(envSchema);
const logger = createLogger(SERVICE);
const connection = createQueueConnection(env.REDIS_QUEUE_URL);

// Model calls from the worker go through the same caps and ledger as the API's.
const database = createDatabase({ url: env.DATABASE_URL, maxConnections: 5 });
const redisCache = new Redis(env.REDIS_CACHE_URL, {
  connectionName: "worker-spend",
  maxRetriesPerRequest: 1,
  commandTimeout: 500,
  enableOfflineQueue: false,
});
redisCache.on("error", () => undefined); // spend checks fall back to the ledger
const ledger = createUsageLedger(database.db);
const spend = createSpendGuard({
  store: redisSpendStore(redisCache),
  limits: spendLimitsFromEnv(env),
  logger,
  ledgerFallback: ledger.spentSince,
});
const ai = createAi(aiOptionsFromEnv(env, { spend, ledger, logger }));
const objects = createS3ObjectStore(env);
const uploads = createSqsUploadQueue(env);
const index = createQdrantIndex({
  url: env.QDRANT_URL,
  collection: env.QDRANT_COLLECTION,
  dimensions: ai.registry.forRole("embedding").dimensions ?? 1536,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});
await index
  .ensureCollection()
  .catch((error: unknown) => logger.error({ err: error }, "Could not prepare the search index"));
if (env.STORAGE_AUTO_CREATE) {
  await uploads
    .ensureQueue()
    .catch((error: unknown) => logger.error({ err: error }, "Could not create the upload queue"));
}

const systemWorker = new Worker(QUEUE_NAMES.system, (job) => processSystemJob(job, logger), {
  connection,
  concurrency: env.WORKER_CONCURRENCY,
});

const store = createDocumentStore(database.db);
const documentsWorker = new Worker(
  QUEUE_NAMES.documents,
  async (job) => {
    const parsed = jobSchemas.documents.ingest.safeParse(job.data);
    if (!parsed.success)
      throw new UnrecoverableError(`Invalid ingest payload: ${parsed.error.message}`);
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return ingestDocument({ store, objects, index, ai, logger }, parsed.data, { isLastAttempt });
  },
  // Long documents take a while to embed; keep the job's lock alive meanwhile.
  { connection, concurrency: env.INGEST_CONCURRENCY, lockDuration: 120_000 },
);
const documentsQueue = new Queue(QUEUE_NAMES.documents, { connection });
const consumer = startUploadConsumer({
  uploads,
  bucket: objects.bucket,
  queue: documentsQueue,
  logger,
});

for (const [name, worker] of [
  [QUEUE_NAMES.system, systemWorker],
  [QUEUE_NAMES.documents, documentsWorker],
] as const) {
  worker.on("ready", () => logger.info({ queue: name }, "Worker ready"));
  worker.on("failed", (job, error) =>
    logger.error({ queue: name, jobId: job?.id, err: error }, "Job failed"),
  );
  worker.on("error", (error) => logger.error({ queue: name, err: error }, "Worker error"));
}

const healthServer = startHealthServer(env.WORKER_HEALTH_PORT, {
  isRunning: () => systemWorker.isRunning() && documentsWorker.isRunning() && consumer.isHealthy(),
  isConnected: () => connection.status === "ready",
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down, waiting for running jobs");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  healthServer.close();
  await consumer.stop();
  await Promise.all([systemWorker.close(), documentsWorker.close()]);
  await documentsQueue.close();
  await Promise.allSettled([connection.quit(), redisCache.quit(), database.close()]);
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
