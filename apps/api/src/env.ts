import { aiEnvShape } from "@tessel/ai";
import { logLevelSchema, nodeEnvSchema } from "@tessel/config/env";
import { graphEnvShape } from "@tessel/graph";
import { connectorsEnvShape } from "@tessel/mcp";
import { storageEnvShape } from "@tessel/storage";
import { z } from "zod";

const DEV_SECRET_MARKER = "dev-only";
const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

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
    /** OAuth apps for "Continue with Google / GitHub". Each is off without its ID and secret. */
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,
    /** Development and tests: a mock Google and GitHub (see src/testing/mock-oauth.ts). */
    SOCIAL_LOGIN_MOCK_URL: optional,
    /** Admins need two-step sign-in for the admin app. Defaults to on in production. */
    ADMIN_REQUIRE_TWO_FACTOR: z.stringbool().optional(),
    /** Plan usage limits and model tiers for chat. Leave on; off only for load tests. */
    ENFORCE_PLAN_LIMITS: z.stringbool().default(true),
    /** Tessel's MCP server as outside clients reach it; the API signs those clients in. */
    MCP_PUBLIC_URL: z.url().optional(),
    /** Stripe, for card payments. Off without a secret key. */
    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,
    STRIPE_PRICE_PRO: optional,
    STRIPE_PRICE_MAX: optional,
    STRIPE_PRICE_TEAM: optional,
    /** Razorpay, for payments in India. Off without a key. */
    RAZORPAY_KEY_ID: optional,
    RAZORPAY_KEY_SECRET: optional,
    RAZORPAY_WEBHOOK_SECRET: optional,
    RAZORPAY_PLAN_PRO: optional,
    RAZORPAY_PLAN_MAX: optional,
    RAZORPAY_PLAN_TEAM: optional,
    /** Rupees per US dollar, for charging extra usage through Razorpay. */
    RAZORPAY_USD_TO_INR: z.coerce.number().positive().default(85),
    /** Development and tests: a mock Stripe and Razorpay (src/testing/mock-payments.ts). */
    PAYMENTS_MOCK_URL: optional,
    /** sns texts with Amazon SNS; outbox keeps texts in memory; off hides phone sign-in. */
    SMS_TRANSPORT: z.enum(["sns", "outbox", "off"]).optional(),
    SMS_SENDER_ID: optional,
    /** India's DLT registration, needed to text Indian numbers through SNS. */
    SMS_DLT_ENTITY_ID: optional,
    SMS_DLT_TEMPLATE_ID: optional,
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
    if (env.NODE_ENV === "production" && !env.MCP_PUBLIC_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["MCP_PUBLIC_URL"],
        message:
          "Set MCP_PUBLIC_URL to the MCP server's public address, like https://mcp.example.com",
      });
    }
    if (env.NODE_ENV === "production" && env.SOCIAL_LOGIN_MOCK_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["SOCIAL_LOGIN_MOCK_URL"],
        message: "The mock sign-in provider is for development only",
      });
    }
    if (env.NODE_ENV === "production" && env.PAYMENTS_MOCK_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENTS_MOCK_URL"],
        message: "The mock payment provider is for development only",
      });
    }
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "Set it with STRIPE_SECRET_KEY",
      });
    }
    if (env.RAZORPAY_KEY_ID && (!env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["RAZORPAY_KEY_SECRET"],
        message: "Set RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET with RAZORPAY_KEY_ID",
      });
    }
    if (env.NODE_ENV === "production" && env.SMS_TRANSPORT === "outbox") {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_TRANSPORT"],
        message: "Production must text with SNS, or turn phone sign-in off",
      });
    }
    for (const provider of ["GOOGLE", "GITHUB"] as const) {
      if (Boolean(env[`${provider}_CLIENT_ID`]) !== Boolean(env[`${provider}_CLIENT_SECRET`])) {
        ctx.addIssue({
          code: "custom",
          path: [`${provider}_CLIENT_SECRET`],
          message: `Set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET, or neither`,
        });
      }
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
        message: "Replace the development encryption key before running in production",
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
