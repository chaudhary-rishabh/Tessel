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
import { createDatabase, createUsageLedger, pingDatabase } from "@tessel/db";
import { createSecretBox } from "@tessel/mcp";
import { graphStoreFromEnv } from "@tessel/graph";
import { createQdrantEpisodeIndex } from "@tessel/memory";
import { createMemoryQueue, createQueueConnection } from "@tessel/queue";
import { createS3ObjectStore, createSqsUploadQueue } from "@tessel/storage";
import { createLogger } from "@tessel/logger";
import { RedisStore } from "rate-limit-redis";
import { createApp } from "./app";
import { createOutboxMailer, createSesMailer } from "./lib/mailer";
import { createOutboxSms, createSnsSms } from "./lib/sms";
import { createSocialProviders } from "./modules/auth/social-providers";
import { connectorCatalog } from "./modules/connectors/connectors.catalog";
import { configFromEnv } from "./config";
import { envSchema } from "./env";
import { createCheck, httpProbe } from "./modules/health/checks";
import { createRedisClient } from "./redis";

const SHUTDOWN_TIMEOUT_MS = 10_000;

loadEnvFiles();
const env = parseEnv(envSchema);
const config = configFromEnv(env);
const logger = createLogger(config.service);

const database = createDatabase({ url: env.DATABASE_URL });
const redisCache = createRedisClient(env.REDIS_CACHE_URL, "redis-cache", logger);
const redisQueue = createRedisClient(env.REDIS_QUEUE_URL, "redis-queue", logger);
// Rate limiting fails open: if Redis is slow or down, requests go through
// after a short timeout instead of failing.
const rateLimitRedis = createRedisClient(env.REDIS_CACHE_URL, "rate-limit", logger, {
  offlineQueue: true,
  commandTimeoutMs: 250,
});

// Spend counters live in the cache Redis; the Postgres ledger is the source
// of truth and is read instead whenever Redis is unavailable.
const ledger = createUsageLedger(database.db);
const spend = createSpendGuard({
  store: redisSpendStore(redisCache),
  limits: spendLimitsFromEnv(env),
  logger,
  ledgerFallback: ledger.spentSince,
});
// Embeddings and search results are cached in the cache Redis (failing open).
const cache = redisKeyValueCache(redisCache, { prefix: "tessel:" });
const ai = createAi(aiOptionsFromEnv(env, { spend, ledger, logger, cache }));
if (!ai.isConfigured) {
  logger.warn("AI is off: set AI_GATEWAY_API_KEY (or a fallback provider key) to turn it on");
}

const objects = createS3ObjectStore(env);
const uploads = createSqsUploadQueue(env);
const vectorIndex = withSearchCache(
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
const graph = graphStoreFromEnv(env);
await graph
  ?.ensureSchema()
  .catch((error: unknown) => logger.error({ err: error }, "Could not prepare the knowledge graph"));
const memoryQueue = createMemoryQueue(createQueueConnection(env.REDIS_QUEUE_URL));

// Emulators start empty: create the bucket, its CORS rules, and the queue.
// In AWS these are created once by the setup steps in infra/aws/README.md.
if (env.STORAGE_AUTO_CREATE) {
  await Promise.all([objects.ensureBucket(env.WEB_ORIGIN), uploads.ensureQueue()]).catch(
    (error: unknown) =>
      logger.error({ err: error }, "Could not create the storage bucket or upload queue"),
  );
}
await Promise.all([vectorIndex.ensureCollection(), episodes.ensureCollection()]).catch(
  (error: unknown) => logger.error({ err: error }, "Could not prepare the search indexes"),
);

/** Phone sign-in: SNS in production when turned on, an outbox in development. */
function smsFromEnv() {
  const transport = env.SMS_TRANSPORT ?? (config.isProduction ? "off" : "outbox");
  if (transport === "off") return undefined;
  if (transport === "outbox") return createOutboxSms({ logger });
  return createSnsSms({
    region: env.AWS_REGION,
    senderId: env.SMS_SENDER_ID,
    dltEntityId: env.SMS_DLT_ENTITY_ID,
    dltTemplateId: env.SMS_DLT_TEMPLATE_ID,
  });
}

const app = createApp({
  config,
  logger,
  db: database.db,
  ai,
  storage: { objects, uploads, uploadEvents: env.UPLOAD_EVENTS },
  vectorIndex,
  memory: { episodes, queue: memoryQueue },
  graph,
  mailer:
    env.MAIL_TRANSPORT === "ses"
      ? createSesMailer({ region: env.AWS_REGION, from: env.MAIL_FROM })
      : createOutboxMailer({ logger }),
  signIn: {
    apiPublicUrl: env.API_PUBLIC_URL,
    providers: createSocialProviders({
      google:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
          : undefined,
      github:
        env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
          ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
          : undefined,
      mockBaseUrl: env.SOCIAL_LOGIN_MOCK_URL,
    }),
    sms: smsFromEnv(),
  },
  connectors: {
    box: createSecretBox(env.ENCRYPTION_KEY),
    catalog: connectorCatalog({
      githubUrl: env.GITHUB_MCP_URL,
      githubClient: env.GITHUB_MCP_CLIENT_ID
        ? {
            clientId: env.GITHUB_MCP_CLIENT_ID,
            ...(env.GITHUB_MCP_CLIENT_SECRET ? { clientSecret: env.GITHUB_MCP_CLIENT_SECRET } : {}),
          }
        : undefined,
    }),
    redirectUrl: new URL("/connectors/oauth/callback", env.API_PUBLIC_URL).toString(),
    webOrigin: env.WEB_ORIGIN[0]!,
    allowPrivate: env.CONNECTORS_ALLOW_PRIVATE_NETWORKS,
  },
  // Shared counters, so limits hold across every API instance.
  rateLimitStoreFactory: (name) =>
    new RedisStore({
      prefix: `rl:${name}:`,
      sendCommand: (command: string, ...args: string[]) =>
        rateLimitRedis.call(command, ...args) as Promise<number>,
    }),
  readinessChecks: [
    createCheck("postgres", () => pingDatabase(database.pool)),
    createCheck("redis-cache", () => redisCache.ping()),
    createCheck("redis-queue", () => redisQueue.ping()),
    createCheck("qdrant", () => vectorIndex.ping()),
    createCheck("s3", () => objects.ping()),
    createCheck("sqs", () => uploads.ping()),
    // Bolt when the graph is set up (what the app actually uses), HTTP otherwise.
    createCheck("neo4j", graph ? () => graph.ping() : httpProbe(env.NEO4J_HTTP_URL)),
  ],
});

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "API listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");

  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.allSettled([
    database.close(),
    redisCache.quit(),
    redisQueue.quit(),
    memoryQueue.close(),
    graph?.close(),
    rateLimitRedis.quit(),
  ]);
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
