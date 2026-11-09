import { randomBytes, randomUUID } from "node:crypto";
import {
  createAi,
  createSpendGuard,
  loadModelRegistry,
  memorySpendStore,
  type Ai,
  type AiOptions,
  type SpendLimits,
} from "@tessel/ai";
import type { AuthResponse } from "@tessel/contracts";
import { createDatabase, createUsageLedger, type DatabaseConnection } from "@tessel/db";
import { memoryObjectStore, memoryUploadQueue } from "@tessel/storage/testing";
import { memoryVectorIndex } from "@tessel/ai";
import { createLogger } from "@tessel/logger";
import { memoryGraphStore } from "@tessel/graph";
import { createSecretBox } from "@tessel/mcp";
import { createOutboxMailer } from "../src/lib/mailer";
import { createOutboxSms } from "../src/lib/sms";
import { memoryEpisodeIndex, type ThreadMemoryJob } from "@tessel/memory";
import type { Express } from "express";
import request from "supertest";
import { afterAll, inject, vi } from "vitest";
import { createApp, type AppDependencies } from "../src/app";
import type { AppConfig, AuthConfig, RateLimitConfig } from "../src/config";
import { createPasswordHasher } from "../src/modules/auth/password";
import { connectorCatalog } from "../src/modules/connectors/connectors.catalog";
import type { ConnectorsSettings } from "../src/modules/connectors/connectors.service";
import type { MemoryQueue } from "../src/modules/memory/memory.service";

export const WEB_ORIGIN = "http://localhost:3000";
export const TEST_PASSWORD = "correct horse battery";

const silentLogger = createLogger("api-test", { level: "silent", pretty: false });
// Cheap hashing settings: same algorithm, far faster tests.
const fastHasher = createPasswordHasher({ memoryCost: 1024, timeCost: 1 });

const connections: DatabaseConnection[] = [];
afterAll(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

export function connect(url: string = inject("testDatabaseUrl")): DatabaseConnection {
  const connection = createDatabase({ url, maxConnections: 5 });
  connections.push(connection);
  return connection;
}

export type ConfigOverrides = Partial<Omit<AppConfig, "auth" | "rateLimits">> & {
  auth?: Partial<AuthConfig>;
  rateLimits?: Partial<RateLimitConfig>;
};

const GENEROUS = { windowMs: 60_000, limit: 10_000 };

export function testConfig(overrides: ConfigOverrides = {}): AppConfig {
  const { auth, rateLimits, ...rest } = overrides;
  return {
    service: "api",
    isProduction: false,
    adminRequireTwoFactor: false,
    enforcePlanLimits: true,
    corsOrigins: [WEB_ORIGIN],
    trustProxy: 0,
    ...rest,
    auth: {
      accessTokenSecret: "test-secret-that-is-at-least-32-characters-long",
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      refreshRotationGraceMs: 10_000,
      cookieSecure: false,
      ...auth,
    },
    // Generous by default so ordinary tests never hit limits.
    rateLimits: {
      api: GENEROUS,
      signup: GENEROUS,
      login: GENEROUS,
      refresh: GENEROUS,
      password: GENEROUS,
      ai: GENEROUS,
      ...rateLimits,
    },
  };
}

const registry = loadModelRegistry();

export interface TestAiOptions {
  /** Mock gateway base URL. Without it, AI is not configured. */
  gatewayUrl?: string;
  limits?: SpendLimits;
  moderation?: AiOptions["moderation"];
  cache?: AiOptions["cache"];
  /** A live registry, for tests that edit models through the admin API. */
  registry?: AiOptions["registry"];
}

/** AI wired like production (Postgres ledger, row-level security), but with a mock gateway. */
export function createTestAi({
  gatewayUrl,
  limits,
  moderation,
  cache,
  registry: liveRegistry,
}: TestAiOptions = {}): Ai {
  const ledger = createUsageLedger(connect().db);
  return createAi({
    ...(gatewayUrl ? { gateway: { apiKey: "test-gateway-key", baseURL: gatewayUrl } } : {}),
    registry: liveRegistry ?? registry,
    ledger,
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: limits ?? { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger: silentLogger,
      ledgerFallback: ledger.spentSince,
    }),
    moderation: moderation ?? { mode: "model", failure: "allow" },
    ...(cache ? { cache } : {}),
    logger: silentLogger,
    timeoutMs: 5_000,
  });
}

/** A memory queue that records jobs, so tests can run them when they choose. */
export function recordingMemoryQueue(): MemoryQueue & { jobs: ThreadMemoryJob[] } {
  const jobs: ThreadMemoryJob[] = [];
  return {
    jobs,
    enqueue: async (job) => {
      if (!jobs.some((item) => item.threadId === job.threadId)) jobs.push(job);
    },
  };
}

/** Connector settings for tests: a throwaway key, local servers allowed. */
export function testConnectors(overrides: { githubUrl?: string } = {}): ConnectorsSettings {
  return {
    box: createSecretBox(randomBytes(32).toString("base64")),
    catalog: connectorCatalog({ githubUrl: overrides.githubUrl ?? "https://github.invalid/mcp" }),
    redirectUrl: "http://localhost:4000/connectors/oauth/callback",
    webOrigin: "http://localhost:3000",
    allowPrivate: true,
  };
}

export function createTestApp(
  overrides: { config?: ConfigOverrides } & Partial<Omit<AppDependencies, "config">> = {},
): Express {
  const { config, ...deps } = overrides;
  return createApp({
    config: testConfig(config),
    logger: silentLogger,
    db: connect().db,
    ai: createTestAi(),
    storage: { objects: memoryObjectStore(), uploads: memoryUploadQueue(), uploadEvents: "api" },
    vectorIndex: memoryVectorIndex(),
    readinessChecks: [],
    connectors: testConnectors(),
    mailer: testOutbox,
    signIn: { apiPublicUrl: "http://localhost:4000", sms: testSms },
    memory: { episodes: memoryEpisodeIndex(), queue: recordingMemoryQueue() },
    graph: memoryGraphStore(),
    passwordHasher: fastHasher,
    ...deps,
  });
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}

export interface SignedUpUser {
  auth: AuthResponse;
  email: string;
  /** The raw `tessel_rt=...` cookie pair, ready for a Cookie header. */
  refreshCookie: string;
}

export function findRefreshCookie(setCookie: string[] | string | undefined): string | undefined {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = cookies.find((value) => value.startsWith("tessel_rt="));
  return header?.split(";")[0];
}

/** The emails every test app sends (signup codes, reset links). */
export const testOutbox = createOutboxMailer();

/**
 * Waits for a password reset email, which is sent after the response, and
 * returns its token. Pass the last token to wait for a newer link.
 */
export async function resetLinkToken(to: string, previous?: string): Promise<string> {
  return vi.waitFor(
    () => {
      const token = /reset-password\?token=([\w-]+)/.exec(testOutbox.latest(to)?.text ?? "")?.[1];
      if (!token || token === previous) throw new Error(`No new reset link for ${to} yet`);
      return token;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** The texts every test app sends (phone sign-in codes). */
export const testSms = createOutboxSms();

/** The newest six-digit code texted to a number. */
export function textedCode(phone: string): string {
  const code = /\b(\d{6})\b/.exec(testSms.latest(phone)?.text ?? "")?.[1];
  if (!code) throw new Error(`No code was texted to ${phone}`);
  return code;
}

/** The newest six-digit code emailed to an address. */
export function emailedCode(email: string): string {
  const code = /\b(\d{6})\b/.exec(testOutbox.latest(email)?.text ?? "")?.[1];
  if (!code) throw new Error(`No code was emailed to ${email}`);
  return code;
}

/** Signs up the way a person does: submit the form, then enter the emailed code. */
export async function signUp(
  app: Express,
  { email = uniqueEmail(), name = "Ada Lovelace", password = TEST_PASSWORD } = {},
): Promise<SignedUpUser> {
  const started = await request(app).post("/auth/signup").send({ email, name, password });
  if (started.status !== 202) {
    throw new Error(`Signup failed: ${started.status} ${JSON.stringify(started.body)}`);
  }
  const res = await request(app)
    .post("/auth/signup/verify")
    .send({ challengeId: started.body.challengeId, code: emailedCode(email) });
  if (res.status !== 201) {
    throw new Error(`Signup verification failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const refreshCookie = findRefreshCookie(res.headers["set-cookie"]);
  if (!refreshCookie) throw new Error("Signup did not set a refresh cookie");
  return { auth: res.body as AuthResponse, email, refreshCookie };
}

export function bearer(user: SignedUpUser): string {
  return `Bearer ${user.auth.accessToken}`;
}
