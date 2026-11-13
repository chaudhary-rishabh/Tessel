import { workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, PoliciesService } from "./policies.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

/** Routes under /workspaces/:workspaceId/policies. */
export function createPoliciesRouter({
  service,
  authenticate,
}: {
  service: PoliciesService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json(await service.get(actorFor(req)));
  });
  router.put("/", async (req, res) => {
    res.json(await service.update(actorFor(req), req.body));
  });
  return router;
}
