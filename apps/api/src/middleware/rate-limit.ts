import type { ApiError } from "@tessel/contracts";
import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";

export interface RateLimitRule {
  windowMs: number;
  limit: number;
}

/** Returns a store for a named limiter, or undefined for the in-memory store. */
export type RateLimitStoreFactory = (name: string) => Store | undefined;

export interface CreateRateLimiterOptions extends RateLimitRule {
  name: string;
  storeFactory?: RateLimitStoreFactory | undefined;
  /** Extra key part, for example the email being logged into. */
  keySuffix?: (req: Request) => string | undefined;
}

export function createRateLimiter({
  name,
  windowMs,
  limit,
  storeFactory,
  keySuffix,
}: CreateRateLimiterOptions) {
  const store = storeFactory?.(name);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // If Redis is down, let requests through rather than taking the API down.
    passOnStoreError: true,
    ...(store ? { store } : {}),
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip ?? "unknown");
      const suffix = keySuffix?.(req);
      return suffix ? `${ip}:${suffix}` : ip;
    },
    handler: (req, res) => {
      const body: ApiError = {
        error: {
          code: "rate_limited",
          message: "Too many requests. Try again later.",
          requestId: req.requestId,
        },
      };
      res.status(429).json(body);
    },
  });
}
