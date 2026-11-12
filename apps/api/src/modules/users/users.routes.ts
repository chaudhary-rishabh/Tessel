import { Router, type RequestHandler } from "express";
import type { RateLimitRule } from "../../middleware/rate-limit";
import {
  createRateLimiter,
  userKey,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { createUsersController } from "./users.controller";

export function createUsersRouter({
  controller,
  authenticate,
  passwordRateLimit,
  emailRateLimit,
  storeFactory,
}: {
  controller: ReturnType<typeof createUsersController>;
  authenticate: RequestHandler;
  passwordRateLimit: RateLimitRule;
  /** Sending confirmation emails, per user. */
  emailRateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router();
  const passwordLimiter = createRateLimiter({
    name: "account-security",
    ...passwordRateLimit,
    storeFactory,
    key: userKey,
  });

  const emailLimiter = createRateLimiter({
    name: "email-verification",
    ...emailRateLimit,
    storeFactory,
    key: userKey,
  });

  router.use(authenticate);
  router.get("/me", controller.getMe);
  router.patch("/me", controller.updateMe);
  router.post("/me/email/verify", passwordLimiter, controller.verifyEmail);
  router.post("/me/email/verification", emailLimiter, controller.resendEmailVerification);
  router.post("/me/password", passwordLimiter, controller.changePassword);
  router.post("/me/two-factor/setup", passwordLimiter, controller.setupTwoFactor);
  router.post("/me/two-factor/enable", passwordLimiter, controller.enableTwoFactor);
  router.post("/me/two-factor/disable", passwordLimiter, controller.disableTwoFactor);
  router.post("/me/two-factor/recovery-codes", passwordLimiter, controller.regenerateRecoveryCodes);

  return router;
}
