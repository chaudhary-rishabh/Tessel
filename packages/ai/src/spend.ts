import type { Logger } from "@tessel/logger";
import type { Redis } from "ioredis";
import { CostCapExceededError, type SpendScope } from "./errors";
import { usdToNano } from "./usage";

/** Daily spend caps in US dollars. 0 turns a cap off. */
export interface SpendLimits {
  userDailyUsd: number;
  workspaceDailyUsd: number;
  globalDailyUsd: number;
}

/** Counters keyed by day. Redis in production; in memory for tests. */
export interface SpendStore {
  get(keys: string[]): Promise<number[]>;
  add(keys: string[], amount: number, ttlSeconds: number): Promise<void>;
}

export interface SpendSubject {
  userId: string;
  workspaceId: string;
}

export interface SpendToday {
  /** Nano-dollars spent today (UTC) per scope. */
  user: number;
  workspace: number;
  global: number;
  limits: { user: number; workspace: number; global: number };
  resetsAt: Date;
}

export interface SpendGuard {
  /** Throws CostCapExceededError when any of today's caps is already used up. */
  assertWithinBudget(subject: SpendSubject): Promise<void>;
  add(subject: SpendSubject, nanoUsd: number): Promise<void>;
  today(subject: SpendSubject): Promise<SpendToday>;
}

/** Reads spend from the source of truth (the usage ledger) when Redis is down. */
export type LedgerSpendFallback = (
  subject: SpendSubject,
  since: Date,
) => Promise<{ user: number; workspace: number }>;

const KEY_TTL_SECONDS = 2 * 86_400;

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * Daily cost caps per user, per workspace, and for the whole service. The
 * check happens before every model call and the cost is added after it, so
 * calls already running when a cap is reached can finish: a cap can be
 * exceeded by at most the calls in flight at that moment.
 *
 * If Redis is unavailable, user and workspace spend are read from the usage
 * ledger instead, so a cache outage never turns those caps off. (The global
 * cap is skipped until Redis is back.)
 */
export function createSpendGuard({
  store,
  limits,
  logger,
  ledgerFallback,
  now = () => new Date(),
}: {
  store: SpendStore;
  limits: SpendLimits;
  logger: Logger;
  ledgerFallback?: LedgerSpendFallback;
  now?: () => Date;
}): SpendGuard {
  const caps = {
    user: usdToNano(limits.userDailyUsd),
    workspace: usdToNano(limits.workspaceDailyUsd),
    global: usdToNano(limits.globalDailyUsd),
  };

  const window = () => {
    const start = startOfUtcDay(now());
    return {
      start,
      day: start.toISOString().slice(0, 10),
      resetsAt: new Date(start.getTime() + 86_400_000),
    };
  };

  const keys = (day: string, subject: SpendSubject) => [
    `ai:spend:${day}:user:${subject.userId}`,
    `ai:spend:${day}:workspace:${subject.workspaceId}`,
    `ai:spend:${day}:global`,
  ];

  async function read(subject: SpendSubject): Promise<SpendToday> {
    const { start, day, resetsAt } = window();
    try {
      const [user = 0, workspace = 0, global = 0] = await store.get(keys(day, subject));
      return { user, workspace, global, limits: caps, resetsAt };
    } catch (error) {
      if (!ledgerFallback) throw error;
      logger.warn({ err: error }, "Spend counters unavailable, reading the usage ledger");
      const { user, workspace } = await ledgerFallback(subject, start);
      return { user, workspace, global: 0, limits: caps, resetsAt };
    }
  }

  return {
    async assertWithinBudget(subject) {
      const spent = await read(subject);
      const order: SpendScope[] = ["global", "workspace", "user"];
      for (const scope of order) {
        const cap = caps[scope];
        if (cap > 0 && spent[scope] >= cap) {
          throw new CostCapExceededError(scope, spent.resetsAt);
        }
      }
    },

    async add(subject, nanoUsd) {
      if (nanoUsd <= 0) return;
      await store.add(keys(window().day, subject), Math.round(nanoUsd), KEY_TTL_SECONDS);
    },

    today: read,
  };
}

export function redisSpendStore(redis: Redis): SpendStore {
  return {
    async get(keys) {
      const values = await redis.mget(...keys);
      return values.map((value) => Number(value ?? 0));
    },
    async add(keys, amount, ttlSeconds) {
      const pipeline = redis.multi();
      for (const key of keys) {
        pipeline.incrby(key, amount);
        pipeline.expire(key, ttlSeconds);
      }
      const results = await pipeline.exec();
      const failed = results?.find(([error]) => error);
      if (failed?.[0]) throw failed[0];
    },
  };
}

/** Single-process store for tests and local tools. */
export function memorySpendStore(): SpendStore {
  const values = new Map<string, number>();
  return {
    get: async (keys) => keys.map((key) => values.get(key) ?? 0),
    add: async (keys, amount) => {
      for (const key of keys) values.set(key, (values.get(key) ?? 0) + amount);
    },
  };
}
