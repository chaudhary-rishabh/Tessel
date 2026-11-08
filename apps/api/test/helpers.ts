import { randomUUID } from "node:crypto";
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
import type { Express } from "express";
import request from "supertest";
import { afterAll, inject } from "vitest";
import { createApp, type AppDependencies } from "../src/app";
import type { AppConfig, AuthConfig, RateLimitConfig } from "../src/config";
import { createPasswordHasher } from "../src/modules/auth/password";

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
}

/** AI wired like production (Postgres ledger, row-level security), but with a mock gateway. */
export function createTestAi({ gatewayUrl, limits, moderation }: TestAiOptions = {}): Ai {
  const ledger = createUsageLedger(connect().db);
  return createAi({
    ...(gatewayUrl ? { gateway: { apiKey: "test-gateway-key", baseURL: gatewayUrl } } : {}),
    registry,
    ledger,
    spend: createSpendGuard({
      store: memorySpendStore(),
      limits: limits ?? { userDailyUsd: 100, workspaceDailyUsd: 100, globalDailyUsd: 100 },
      logger: silentLogger,
      ledgerFallback: ledger.spentSince,
    }),
    moderation: moderation ?? { mode: "model", failure: "allow" },
    logger: silentLogger,
    timeoutMs: 5_000,
  });
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

export async function signUp(
  app: Express,
  { email = uniqueEmail(), name = "Ada Lovelace", password = TEST_PASSWORD } = {},
): Promise<SignedUpUser> {
  const res = await request(app).post("/auth/signup").send({ email, name, password });
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const refreshCookie = findRefreshCookie(res.headers["set-cookie"]);
  if (!refreshCookie) throw new Error("Signup did not set a refresh cookie");
  return { auth: res.body as AuthResponse, email, refreshCookie };
}

export function bearer(user: SignedUpUser): string {
  return `Bearer ${user.auth.accessToken}`;
}
