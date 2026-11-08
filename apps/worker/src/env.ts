import { aiEnvShape } from "@tessel/ai";
import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { storageEnvShape } from "@tessel/storage";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  REDIS_QUEUE_URL: z.url(),
  /** Spend cap counters live in the cache Redis. */
  REDIS_CACHE_URL: z.url(),
  /** Restricted app role; row-level security applies to the worker too. */
  DATABASE_URL: z.url(),
  QDRANT_URL: z.url(),
  QDRANT_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  QDRANT_COLLECTION: z.string().min(1).default("tessel_chunks"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  /** Documents processed at once. Each holds a whole file in memory. */
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4200),
  ...aiEnvShape,
  ...storageEnvShape,
});

export type Env = z.infer<typeof envSchema>;
