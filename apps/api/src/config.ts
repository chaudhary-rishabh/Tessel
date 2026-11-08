import type { Env } from "./env";
import type { RateLimitRule } from "./middleware/rate-limit";

export interface AuthConfig {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  /**
   * How long a just-rotated refresh token is treated as a harmless race
   * (two tabs refreshing at once) instead of token theft.
   */
  refreshRotationGraceMs: number;
  cookieSecure: boolean;
}

export interface RateLimitConfig {
  /** Every route except health checks, per IP. */
  api: RateLimitRule;
  /** Account creation, per IP. */
  signup: RateLimitRule;
  /** Login attempts, per IP and email. */
  login: RateLimitRule;
  /** Token refreshes, per IP. */
  refresh: RateLimitRule;
  /** Password changes, per user. */
  password: RateLimitRule;
}

export interface AppConfig {
  service: string;
  isProduction: boolean;
  corsOrigins: string[];
  trustProxy: number;
  auth: AuthConfig;
  rateLimits: RateLimitConfig;
}

const MINUTE = 60_000;

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  api: { windowMs: MINUTE, limit: 300 },
  signup: { windowMs: 60 * MINUTE, limit: 10 },
  login: { windowMs: 15 * MINUTE, limit: 10 },
  refresh: { windowMs: MINUTE, limit: 30 },
  password: { windowMs: 15 * MINUTE, limit: 5 },
};

export function configFromEnv(env: Env): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  return {
    service: "api",
    isProduction,
    corsOrigins: env.WEB_ORIGIN,
    trustProxy: env.TRUST_PROXY,
    auth: {
      accessTokenSecret: env.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      refreshRotationGraceMs: 10_000,
      cookieSecure: env.COOKIE_SECURE ?? isProduction,
    },
    rateLimits: DEFAULT_RATE_LIMITS,
  };
}
