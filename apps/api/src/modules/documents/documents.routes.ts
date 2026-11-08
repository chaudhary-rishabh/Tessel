import { Router, type RequestHandler } from "express";
import {
  createRateLimiter,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { createDocumentsController } from "./documents.controller";

/** Routes under /workspaces/:workspaceId for documents and search. */
export function createDocumentsRouter({
  controller,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  controller: ReturnType<typeof createDocumentsController>;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const perUser = (name: string) =>
    createRateLimiter({ name, ...rateLimit, storeFactory, keySuffix: (req) => req.auth?.userId });
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/documents", controller.list);
  router.post("/documents", perUser("documents"), controller.create);
  router.get("/documents/:documentId", controller.get);
  router.post("/documents/:documentId/complete", controller.complete);
  router.post("/documents/:documentId/reprocess", perUser("documents"), controller.reprocess);
  router.get("/documents/:documentId/download", controller.download);
  router.get("/documents/:documentId/text", controller.text);
  router.delete("/documents/:documentId", controller.remove);
  router.post("/search", perUser("ai"), controller.search);
  return router;
}
