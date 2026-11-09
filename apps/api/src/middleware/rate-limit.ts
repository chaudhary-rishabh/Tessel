import { createHash } from "node:crypto";
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
  /** Unique per limiter: limiters with the same name share their counts in Redis. */
  name: string;
  storeFactory?: RateLimitStoreFactory | undefined;
  /**
   * Who the limit applies to, given the client's IP: for example the user, the
   * email address, or the IP and address together. Without it, or when it
   * returns nothing, the limit is per IP.
   */
  key?: (req: Request, ip: string) => string | undefined;
}

/** A stable, short hash for limiter keys, so Redis never stores emails or phone numbers. */
export function hashedKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** The hashed, normalised email in a request body, if it has one. */
export function emailKey(req: Request): string | undefined {
  const email: unknown = req.body?.email;
  return typeof email === "string" ? hashedKey(email.trim().toLowerCase()) : undefined;
}

/** The hashed phone number in a request body, if it has one. */
export function phoneKey(req: Request): string | undefined {
  const phone: unknown = req.body?.phone;
  return typeof phone === "string" ? hashedKey(phone.replace(/[^\d+]/g, "")) : undefined;
}

/** The signed-in user, for limits that follow a person across IPs. */
export const userKey = (req: Request): string | undefined => req.auth?.userId;

export function createRateLimiter({
  name,
  windowMs,
  limit,
  storeFactory,
  key,
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
      return key?.(req, ip) ?? ip;
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
