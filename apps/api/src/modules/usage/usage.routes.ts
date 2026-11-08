import { Router, type RequestHandler } from "express";
import type { createUsageController } from "./usage.controller";

/** GET /workspaces/:workspaceId/usage */
export function createUsageRouter({
  controller,
  authenticate,
}: {
  controller: ReturnType<typeof createUsageController>;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.get("/", authenticate, controller.summary);
  return router;
}
