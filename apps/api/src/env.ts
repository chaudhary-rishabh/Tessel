import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url(),
  REDIS_CACHE_URL: z.url(),
  REDIS_QUEUE_URL: z.url(),
  QDRANT_URL: z.url(),
  NEO4J_HTTP_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;
