import { Router, type RequestHandler } from "express";
import type { createWorkspacesController } from "./workspaces.controller";

export function createWorkspacesRouter({
  controller,
  authenticate,
}: {
  controller: ReturnType<typeof createWorkspacesController>;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:workspaceId", controller.get);
  router.patch("/:workspaceId", controller.rename);
  return router;
}
