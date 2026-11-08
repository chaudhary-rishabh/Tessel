import { Redis } from "ioredis";

/**
 * Creates a Redis connection for BullMQ. Workers block on Redis commands, so
 * BullMQ requires `maxRetriesPerRequest: null`. This must point at the queue
 * Redis instance (noeviction), never the cache instance.
 */
export function createQueueConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
