import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  REDIS_QUEUE_URL: z.url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4200),
});

export type Env = z.infer<typeof envSchema>;
