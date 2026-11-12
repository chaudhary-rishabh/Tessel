import { Router, type RequestHandler } from "express";
import { decodeJwt } from "jose";
import type { RateLimitConfig } from "../../config";
import { requireAllowedOrigin } from "../../middleware/origin-check";
import {
  createRateLimiter,
  emailKey,
  hashedKey,
  type CreateRateLimiterOptions,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
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

  const limiter = (name: string, rule: RateLimitRule, key?: CreateRateLimiterOptions["key"]) =>
    createRateLimiter({ name, ...rule, storeFactory, key });
  // Looser per-IP rules for offices and phone networks behind one address.
  const perIp = (rule: RateLimitRule, factor: number) => ({ ...rule, limit: rule.limit * factor });

  const signupIp = limiter("signup-ip", rateLimits.signup);
  // Per address, so nobody can flood someone's inbox from many IPs.
  const signupEmail = limiter("signup-email", rateLimits.signup, emailKey);
  // Logging in: per IP and email, so an attacker elsewhere can't lock a user
  // out; per email, so many IPs can't share the guessing; and per IP overall.
  const loginPair = limiter("login", rateLimits.login, (req, ip) => {
    const email = emailKey(req);
    return email ? `${ip}:${email}` : undefined;
  });
  const loginEmail = limiter("login-email", perIp(rateLimits.login, 5), emailKey);
  const loginIp = limiter("login-ip", perIp(rateLimits.login, 10));
  // A few authenticator codes per user, however many times the password is
  // entered again for a fresh challenge. The user is read from the challenge
  // without checking its signature: that only picks the bucket, and the
  // service still verifies the token.
  const twoFactor = limiter("login-two-factor", rateLimits.password, (req) => {
    const challenge: unknown = req.body?.challengeToken;
    if (typeof challenge !== "string") return undefined;
    try {
      const { sub } = decodeJwt(challenge);
      return sub ? hashedKey(sub) : hashedKey(challenge);
    } catch {
      return hashedKey(challenge);
    }
  });
  const forgotEmail = limiter("password-forgot", rateLimits.signup, emailKey);
  const forgotIp = limiter("password-forgot-ip", perIp(rateLimits.signup, 3));
  const reset = limiter("password-reset", rateLimits.login);
  const refresh = limiter("refresh", rateLimits.refresh);

  router.use(requireAllowedOrigin(allowedOrigins));
  router.post("/signup", signupIp, signupEmail, controller.signup);
  router.post("/login", loginIp, loginEmail, loginPair, controller.login);
  router.post("/login/two-factor", loginIp, twoFactor, controller.twoFactor);
  router.post("/password/forgot", forgotIp, forgotEmail, controller.forgotPassword);
  router.post("/password/reset", reset, controller.resetPassword);
  router.get("/sessions", authenticate, controller.listSessions);
  router.delete("/sessions/:sessionId", authenticate, controller.revokeSession);
  router.post("/refresh", refresh, controller.refresh);
  router.post("/logout", controller.logout);

  return router;
}
