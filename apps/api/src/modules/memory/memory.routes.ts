import { memoryParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, MemoryService } from "./memory.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

const memoryIdOf = (req: Request) => memoryParamsSchema.parse(req.params).memoryId;

/** Routes under /workspaces/:workspaceId/memory, for the signed-in user's own memory. */
export function createMemoryRouter({
  service,
  authenticate,
}: {
  service: MemoryService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json(await service.get(actorFor(req)));
  });
  router.put("/settings", async (req, res) => {
    res.json(await service.saveSettings(actorFor(req), req.body));
  });
  router.post("/memories", async (req, res) => {
    res.status(201).json(await service.add(actorFor(req), req.body));
  });
  router.delete("/memories", async (req, res) => {
    await service.clear(actorFor(req));
    res.status(204).end();
  });
  router.patch("/memories/:memoryId", async (req, res) => {
    res.json(await service.update(actorFor(req), memoryIdOf(req), req.body));
  });
  router.delete("/memories/:memoryId", async (req, res) => {
    await service.remove(actorFor(req), memoryIdOf(req));
    res.status(204).end();
  });
  // Team memory: shared by everyone in a team workspace.
  router.get("/team", async (req, res) => {
    res.json({ memories: await service.listTeam(actorFor(req)) });
  });
  router.post("/team", async (req, res) => {
    res.status(201).json(await service.addTeam(actorFor(req), req.body));
  });
  router.patch("/team/:memoryId", async (req, res) => {
    res.json(await service.updateTeam(actorFor(req), memoryIdOf(req), req.body));
  });
  router.delete("/team/:memoryId", async (req, res) => {
    await service.removeTeam(actorFor(req), memoryIdOf(req));
    res.status(204).end();
  });
  return router;
}
