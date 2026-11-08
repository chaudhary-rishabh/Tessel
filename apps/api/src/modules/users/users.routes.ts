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

  return router;
}
