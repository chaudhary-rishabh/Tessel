import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import type { RateLimitConfig } from "../../config";
import { requireAllowedOrigin } from "../../middleware/origin-check";
import { createRateLimiter, type RateLimitStoreFactory } from "../../middleware/rate-limit";
import type { createAuthController } from "./auth.controller";

export function createAuthRouter({
  controller,
  rateLimits,
  storeFactory,
  allowedOrigins,
  authenticate,
}: {
  authenticate: RequestHandler;
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

  const emailLimiter = createRateLimiter({
    name: "email",
    ...rateLimits.signup,
    storeFactory,
    // Per address too, so nobody can flood someone's inbox from many IPs.
    keySuffix: (req) => {
      const email: unknown = req.body?.email;
      if (typeof email !== "string") return undefined;
      return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
    },
  });

  router.use(requireAllowedOrigin(allowedOrigins));
  router.post("/signup", signupLimiter, emailLimiter, controller.signup);
  router.post("/signup/verify", loginLimiter, controller.verifySignup);
  router.post("/signup/resend", signupLimiter, controller.resendSignup);
  router.post("/login", loginLimiter, controller.login);
  router.post("/login/two-factor", loginLimiter, controller.twoFactor);
  router.post("/password/forgot", emailLimiter, controller.forgotPassword);
  router.post("/password/reset", loginLimiter, controller.resetPassword);
  router.get("/sessions", authenticate, controller.listSessions);
  router.delete("/sessions/:sessionId", authenticate, controller.revokeSession);
  router.post("/refresh", refreshLimiter, controller.refresh);
  router.post("/logout", controller.logout);

  return router;
}
