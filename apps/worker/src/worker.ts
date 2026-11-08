import {
  aiOptionsFromEnv,
  createAi,
  createQdrantIndex,
  redisKeyValueCache,
  withSearchCache,
  createSpendGuard,
  redisSpendStore,
  spendLimitsFromEnv,
} from "@tessel/ai";
import { loadEnvFiles, parseEnv } from "@tessel/config/env";
import { createDatabase, createUsageLedger, runMaintenance } from "@tessel/db";
import { graphStoreFromEnv } from "@tessel/graph";
import { createLogger } from "@tessel/logger";
import { createMemoryStore, createQdrantEpisodeIndex, processThreadMemory } from "@tessel/memory";
import {
  createQueueConnection,
  jobSchemas,
  MAINTENANCE_SCHEDULE,
  QUEUE_NAMES,
} from "@tessel/queue";
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
// Shares the API's cache: re-indexing bumps the workspace's search version there.
const cache = redisKeyValueCache(redisCache, { prefix: "tessel:" });
const ai = createAi(aiOptionsFromEnv(env, { spend, ledger, logger, cache }));
const objects = createS3ObjectStore(env);
const uploads = createSqsUploadQueue(env);
const index = withSearchCache(
  createQdrantIndex({
    url: env.QDRANT_URL,
    collection: env.QDRANT_COLLECTION,
    dimensions: ai.registry.forRole("embedding").dimensions ?? 1536,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
  }),
  cache,
);
const episodes = createQdrantEpisodeIndex({
  url: env.QDRANT_URL,
  collection: env.QDRANT_EPISODES_COLLECTION,
  dimensions: ai.registry.forRole("embedding").dimensions ?? 1536,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});
await Promise.all([index.ensureCollection(), episodes.ensureCollection()]).catch((error: unknown) =>
  logger.error({ err: error }, "Could not prepare the search indexes"),
);
if (env.STORAGE_AUTO_CREATE) {
  await uploads
    .ensureQueue()
    .catch((error: unknown) => logger.error({ err: error }, "Could not create the upload queue"));
}

// Graph RAG: entities and relationships go to Neo4j while documents are indexed.
const graph = env.GRAPH_EXTRACTION ? graphStoreFromEnv(env) : undefined;
await graph
  ?.ensureSchema()
  .catch((error: unknown) => logger.error({ err: error }, "Could not prepare the knowledge graph"));

const systemWorker = new Worker(
  QUEUE_NAMES.system,
  (job) => processSystemJob(job, logger, { maintenance: () => runMaintenance(database.db) }),
  { connection, concurrency: env.WORKER_CONCURRENCY },
);
// One schedule however many workers run: the scheduler is keyed by name.
const systemQueue = new Queue(QUEUE_NAMES.system, { connection });
await systemQueue
  .upsertJobScheduler(
    "maintenance",
    { pattern: MAINTENANCE_SCHEDULE, tz: "UTC" },
    { name: "maintenance", data: {} },
  )
  .catch((error: unknown) => logger.error({ err: error }, "Could not schedule maintenance"));

const store = createDocumentStore(database.db);
const documentsWorker = new Worker(
  QUEUE_NAMES.documents,
  async (job) => {
    const parsed = jobSchemas.documents.ingest.safeParse(job.data);
    if (!parsed.success)
      throw new UnrecoverableError(`Invalid ingest payload: ${parsed.error.message}`);
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    return ingestDocument({ store, objects, index, ai, logger, graph }, parsed.data, {
      isLastAttempt,
    });
  },
  // Long documents take a while to embed; keep the job's lock alive meanwhile.
  { connection, concurrency: env.INGEST_CONCURRENCY, lockDuration: 120_000 },
);
const memoryStore = createMemoryStore(database.db);
const memoryWorker = new Worker(
  QUEUE_NAMES.memory,
  async (job) => {
    const parsed = jobSchemas.memory.thread.safeParse(job.data);
    if (!parsed.success)
      throw new UnrecoverableError(`Invalid memory payload: ${parsed.error.message}`);
    return processThreadMemory({ store: memoryStore, ai, episodes, logger }, parsed.data);
  },
  { connection, concurrency: env.MEMORY_CONCURRENCY },
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
  [QUEUE_NAMES.memory, memoryWorker],
] as const) {
  worker.on("ready", () => logger.info({ queue: name }, "Worker ready"));
  worker.on("failed", (job, error) =>
    logger.error({ queue: name, jobId: job?.id, err: error }, "Job failed"),
  );
  worker.on("error", (error) => logger.error({ queue: name, err: error }, "Worker error"));
}

const healthServer = startHealthServer(env.WORKER_HEALTH_PORT, {
  isRunning: () =>
    systemWorker.isRunning() &&
    documentsWorker.isRunning() &&
    memoryWorker.isRunning() &&
    consumer.isHealthy(),
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
  await Promise.all([systemWorker.close(), documentsWorker.close(), memoryWorker.close()]);
  await Promise.all([documentsQueue.close(), systemQueue.close()]);
  await Promise.allSettled([
    connection.quit(),
    redisCache.quit(),
    database.close(),
    graph?.close(),
  ]);
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
