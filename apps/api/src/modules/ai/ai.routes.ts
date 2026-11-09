import { Router, type RequestHandler } from "express";
import type { RateLimitRule, RateLimitStoreFactory } from "../../middleware/rate-limit";
import { createRateLimiter, userKey } from "../../middleware/rate-limit";
import type { createAiController } from "./ai.controller";

type AiController = ReturnType<typeof createAiController>;

/** GET /models: the models a user can pick. */
export function createModelsRouter({
  controller,
  authenticate,
}: {
  controller: AiController;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.get("/", authenticate, controller.listModels);
  return router;
}

/** POST /workspaces/:workspaceId/completions: one non-streaming reply. */
export function createCompletionsRouter({
  controller,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  controller: AiController;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router({ mergeParams: true });
  router.post(
    "/",
    authenticate,
    createRateLimiter({
      name: "ai",
      ...rateLimit,
      storeFactory,
      key: userKey,
    }),
    controller.complete,
  );
  return router;
}
