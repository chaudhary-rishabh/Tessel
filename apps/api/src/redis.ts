import type { Logger } from "@tessel/logger";
import { Redis } from "ioredis";

export interface RedisClientOptions {
  /**
   * Queue commands while disconnected instead of failing at once. Off by
   * default so request-path calls fail fast; on for clients that issue
   * commands during startup, such as the rate limit store.
   */
  offlineQueue?: boolean;
  /** Fail any command that takes longer than this, so an outage can't stall requests. */
  commandTimeoutMs?: number;
}

/**
 * Redis client whose commands fail quickly when Redis is down, and whose
 * connection errors are logged once per outage instead of on every retry.
 */
export function createRedisClient(
  url: string,
  name: string,
  logger: Logger,
  { offlineQueue = false, commandTimeoutMs = 500 }: RedisClientOptions = {},
): Redis {
  const client = new Redis(url, {
    connectionName: name,
    enableOfflineQueue: offlineQueue,
    maxRetriesPerRequest: 1,
    commandTimeout: commandTimeoutMs,
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
