import { skillFileParamsSchema, skillParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { z } from "zod";
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
  const fileSkill = (req: Request) => skillFileParamsSchema.parse(req.params).skillId;
  const pathOf = (req: Request) =>
    z.object({ path: z.string().min(1).max(200) }).parse(req.query).path;
  router.put("/:skillId/files", async (req, res) => {
    res.json(await service.putFile(actorFor(req), fileSkill(req), req.body));
  });
  router.get("/:skillId/files/content", async (req, res) => {
    res.json(await service.readFile(actorFor(req), fileSkill(req), pathOf(req)));
  });
  router.delete("/:skillId/files", async (req, res) => {
    await service.removeFile(actorFor(req), fileSkill(req), pathOf(req));
    res.status(204).end();
  });
  router.delete("/:skillId", async (req, res) => {
    await service.remove(actorFor(req), skillIdOf(req));
    res.status(204).end();
  });
  return router;
}
