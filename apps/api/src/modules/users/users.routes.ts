import { Router, type RequestHandler } from "express";
import type { RateLimitRule } from "../../middleware/rate-limit";
import { createRateLimiter, type RateLimitStoreFactory } from "../../middleware/rate-limit";
import type { createUsersController } from "./users.controller";

export function createUsersRouter({
  controller,
  authenticate,
  passwordRateLimit,
  storeFactory,
}: {
  controller: ReturnType<typeof createUsersController>;
  authenticate: RequestHandler;
  passwordRateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router();
  const passwordLimiter = createRateLimiter({
    name: "password",
    ...passwordRateLimit,
    storeFactory,
    keySuffix: (req) => req.auth?.userId,
  });

  router.use(authenticate);
  router.get("/me", controller.getMe);
  router.post("/me/password", passwordLimiter, controller.changePassword);
  router.post("/me/two-factor/setup", passwordLimiter, controller.setupTwoFactor);
  router.post("/me/two-factor/enable", passwordLimiter, controller.enableTwoFactor);
  router.post("/me/two-factor/disable", passwordLimiter, controller.disableTwoFactor);
  router.post("/me/two-factor/recovery-codes", passwordLimiter, controller.regenerateRecoveryCodes);

  return router;
}
