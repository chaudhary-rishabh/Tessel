import { loadEnvFiles, parseEnv } from "@tessel/config/env";
import { createDatabase, pingDatabase } from "@tessel/db";
import { createLogger } from "@tessel/logger";
import { RedisStore } from "rate-limit-redis";
import { createApp } from "./app";
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

const app = createApp({
  config,
  logger,
  db: database.db,
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
    createCheck("qdrant", httpProbe(new URL("/readyz", env.QDRANT_URL).toString())),
    createCheck("neo4j", httpProbe(env.NEO4J_HTTP_URL)),
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
    rateLimitRedis.quit(),
  ]);
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
