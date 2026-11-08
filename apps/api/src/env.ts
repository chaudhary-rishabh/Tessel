import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { z } from "zod";

const DEV_SECRET_MARKER = "dev-only";

export const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    API_PORT: z.coerce.number().int().positive().default(4000),
    /** Comma-separated list of web origins allowed to call the API with cookies. */
    WEB_ORIGIN: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    /** Number of proxies in front of the API (1 behind a load balancer). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    /** Restricted app role; row-level security applies to it. */
    DATABASE_URL: z.url(),
    REDIS_CACHE_URL: z.url(),
    REDIS_QUEUE_URL: z.url(),
    QDRANT_URL: z.url(),
    NEO4J_HTTP_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Multiplies every rate limit. Raise it for end-to-end test runs only. */
    RATE_LIMIT_SCALE: z.coerce.number().positive().max(1000).default(1),
    /** Defaults to true in production. Set false only for local HTTP development. */
    COOKIE_SECURE: z.stringbool().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.JWT_ACCESS_SECRET.includes(DEV_SECRET_MARKER)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Replace the development secret before running in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
