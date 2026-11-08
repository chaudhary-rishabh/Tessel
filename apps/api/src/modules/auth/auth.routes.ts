import { createHash } from "node:crypto";
import { Router } from "express";
import type { RateLimitConfig } from "../../config";
import { requireAllowedOrigin } from "../../middleware/origin-check";
import { createRateLimiter, type RateLimitStoreFactory } from "../../middleware/rate-limit";
import type { createAuthController } from "./auth.controller";

export function createAuthRouter({
  controller,
  rateLimits,
  storeFactory,
  allowedOrigins,
}: {
  controller: ReturnType<typeof createAuthController>;
  rateLimits: RateLimitConfig;
  storeFactory?: RateLimitStoreFactory | undefined;
  allowedOrigins: readonly string[];
}): Router {
  const router = Router();

  const signupLimiter = createRateLimiter({ name: "signup", ...rateLimits.signup, storeFactory });
  const loginLimiter = createRateLimiter({
    name: "login",
    ...rateLimits.login,
    storeFactory,
    // Per IP and email, so one attacker can't lock out a user from elsewhere.
    // The email is hashed so limiter keys don't store it in Redis.
    keySuffix: (req) => {
      const email: unknown = req.body?.email;
      if (typeof email !== "string") return undefined;
      return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
    },
  });
  const refreshLimiter = createRateLimiter({
    name: "refresh",
    ...rateLimits.refresh,
    storeFactory,
  });

  router.use(requireAllowedOrigin(allowedOrigins));
  router.post("/signup", signupLimiter, controller.signup);
  router.post("/login", loginLimiter, controller.login);
  router.post("/refresh", refreshLimiter, controller.refresh);
  router.post("/logout", controller.logout);

  return router;
}
