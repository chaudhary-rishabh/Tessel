import {
  createLiveModelRegistry,
  createSpendGuard,
  createUsageTracker,
  readModelsConfig,
  redisSpendStore,
  spendLimitsFromEnv,
  syncLiveRegistry,
  type LiveModelRegistry,
  type SpendGuard,
  type UsageTracker,
} from "@tessel/ai";
import { createDatabase, createUsageLedger, loadModelConfig } from "@tessel/db";
import { createLogger, type Logger } from "@tessel/logger";
import { createMemoryQueue, createQueueConnection } from "@tessel/queue";
import { Redis } from "ioredis";
import { loadEnv, type Env } from "./env";
import { createVoiceStore, type VoiceStore } from "./store";

/** What every conversation in a job process shares: connections, the registry, the ledger. */
export interface VoiceRuntime {
  env: Env;
  logger: Logger;
  store: VoiceStore;
  registry: LiveModelRegistry;
  spend: SpendGuard;
  tracker: UsageTracker;
  memory: {
    enqueue(job: { workspaceId: string; userId: string; threadId: string }): Promise<void>;
  };
}

let runtime: Promise<VoiceRuntime> | undefined;

/** One runtime per job process, created on first use (LiveKit keeps warm processes ready). */
export function getRuntime(): Promise<VoiceRuntime> {
  runtime ??= createRuntime(loadEnv());
  return runtime;
}

async function createRuntime(env: Env): Promise<VoiceRuntime> {
  const logger = createLogger("voice", env.LOG_LEVEL ? { level: env.LOG_LEVEL } : {});
  const database = createDatabase({ url: env.DATABASE_URL, maxConnections: 3 });
  const redisCache = new Redis(env.REDIS_CACHE_URL, {
    connectionName: "voice-spend",
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
  // Models come from the admin app's saved registry when there is one, else models.json.
  const registry = createLiveModelRegistry(readModelsConfig(env.AI_MODELS_FILE));
  await syncLiveRegistry({
    registry,
    load: () => loadModelConfig(database.db),
    onError: (error) => logger.error({ err: error }, "Couldn't load the saved model registry"),
  });
  const memoryQueue = createMemoryQueue(createQueueConnection(env.REDIS_QUEUE_URL));
  return {
    env,
    logger,
    store: createVoiceStore(database.db),
    registry,
    spend,
    tracker: createUsageTracker({ ledger, spend, logger }),
    memory: memoryQueue,
  };
}
