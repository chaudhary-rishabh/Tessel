import { workspaceParamsSchema } from "@tessel/contracts";
import { Router, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { GraphService } from "./graph.service";

/** GET /workspaces/:workspaceId/graph?entity=…: the knowledge graph's size and an entity's relationships. */
export function createGraphRouter({
  service,
  authenticate,
}: {
  service: GraphService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.get("/", authenticate, async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    res.json(await service.explore({ userId: getAuth(req).userId, workspaceId }, req.query));
  });
  return router;
}
