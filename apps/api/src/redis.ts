import type { Logger } from "@tessel/logger";
import { Redis } from "ioredis";

/**
 * Redis client for request-path use: commands fail fast when Redis is down
 * (no offline queue), and connection errors are logged once per outage
 * instead of on every reconnect attempt.
 */
export function createRedisClient(url: string, name: string, logger: Logger): Redis {
  const client = new Redis(url, {
    connectionName: name,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });

  let healthy = true;
  client.on("ready", () => {
    if (!healthy) logger.info({ redis: name }, "Redis connection restored");
    healthy = true;
  });
  client.on("error", (error) => {
    if (healthy) logger.warn({ redis: name, err: error }, "Redis connection lost");
    healthy = false;
  });

  return client;
}
