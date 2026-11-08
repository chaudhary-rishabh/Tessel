import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * A small key-value cache (Redis in production). Every call fails open: if
 * the cache is down, reads miss and writes are skipped, so caching can only
 * make things faster, never break them.
 */
export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Increments a counter (created at 1), e.g. a version that invalidates keys built on it. */
  incr(key: string): Promise<number | null>;
}

/** Hit and miss counts, for logs and tests. */
export interface CacheStats {
  hits: number;
  misses: number;
}

export const cacheKeyHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function redisKeyValueCache(redis: Redis, { prefix = "cache:" } = {}): KeyValueCache {
  const quiet = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch {
      return fallback;
    }
  };
  return {
    get: (key) => quiet(() => redis.get(prefix + key), null),
    mget: (keys) =>
      keys.length
        ? quiet(
            () => redis.mget(keys.map((key) => prefix + key)),
            keys.map(() => null),
          )
        : Promise.resolve([]),
    set: (key, value, ttlSeconds) =>
      quiet(async () => {
        await redis.set(prefix + key, value, "EX", ttlSeconds);
      }, undefined),
    incr: (key) => quiet(() => redis.incr(prefix + key), null),
  };
}

/** An in-process cache for tests and single-instance development. */
export function memoryKeyValueCache(): KeyValueCache & {
  entries: Map<string, { value: string; expires: number }>;
} {
  const entries = new Map<string, { value: string; expires: number }>();
  const read = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  };
  return {
    entries,
    get: async (key) => read(key),
    mget: async (keys) => keys.map(read),
    set: async (key, value, ttlSeconds) => {
      entries.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
    incr: async (key) => {
      const next = Number(read(key) ?? 0) + 1;
      entries.set(key, { value: String(next), expires: Number.POSITIVE_INFINITY });
      return next;
    },
  };
}

/** Packs a vector as base64 float32: a quarter of the size of JSON. */
export function packVector(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

export function unpackVector(packed: string): number[] {
  const bytes = Buffer.from(packed, "base64");
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
}
