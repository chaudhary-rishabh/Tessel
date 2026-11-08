import { skillParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, SkillsService } from "./skills.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

const skillIdOf = (req: Request) => skillParamsSchema.parse(req.params).skillId;

/** Routes under /workspaces/:workspaceId/skills. */
export function createSkillsRouter({
  service,
  authenticate,
}: {
  service: SkillsService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json({ skills: await service.list(actorFor(req)) });
  });
  router.post("/", async (req, res) => {
    res.status(201).json(await service.create(actorFor(req), req.body));
  });
  router.patch("/:skillId", async (req, res) => {
    res.json(await service.update(actorFor(req), skillIdOf(req), req.body));
  });
  router.delete("/:skillId", async (req, res) => {
    await service.remove(actorFor(req), skillIdOf(req));
    res.status(204).end();
  });
  return router;
}
