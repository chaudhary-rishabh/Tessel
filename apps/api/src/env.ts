import { aiEnvShape } from "@tessel/ai";
import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { graphEnvShape } from "@tessel/graph";
import { connectorsEnvShape } from "@tessel/mcp";
import { storageEnvShape } from "@tessel/storage";
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
    QDRANT_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().optional(),
    ),
    QDRANT_COLLECTION: z.string().min(1).default("tessel_chunks"),
    /** Episodic memory: one point per chat, for searching past chats. */
    QDRANT_EPISODES_COLLECTION: z.string().min(1).default("tessel_episodes"),
    NEO4J_HTTP_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Multiplies every rate limit. Raise it for end-to-end test runs only. */
    RATE_LIMIT_SCALE: z.coerce.number().positive().max(1000).default(1),
    /** Defaults to true in production. Set false only for local HTTP development. */
    COOKIE_SECURE: z.stringbool().optional(),
    /** ses sends with Amazon SES; outbox keeps emails in memory (development and tests). */
    MAIL_TRANSPORT: z.enum(["ses", "outbox"]).default("outbox"),
    MAIL_FROM: z.string().min(3).default("Tessel <no-reply@localhost>"),
    ...aiEnvShape,
    ...storageEnvShape,
    ...connectorsEnvShape,
    ...graphEnvShape,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.MAIL_TRANSPORT !== "ses") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message: "Production must send email with SES",
      });
    }
    if (env.NODE_ENV === "production" && env.CONNECTORS_ALLOW_PRIVATE_NETWORKS) {
      ctx.addIssue({
        code: "custom",
        path: ["CONNECTORS_ALLOW_PRIVATE_NETWORKS"],
        message: "Private networks must stay blocked for connectors in production",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      Buffer.from(env.ENCRYPTION_KEY, "base64").toString("latin1").includes(DEV_SECRET_MARKER)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_KEY"],
        message: "Replace the development connector key before running in production",
      });
    }
    if (env.NODE_ENV === "production" && env.JWT_ACCESS_SECRET.includes(DEV_SECRET_MARKER)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Replace the development secret before running in production",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;
