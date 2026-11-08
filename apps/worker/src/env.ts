import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  REDIS_QUEUE_URL: z.url(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;
