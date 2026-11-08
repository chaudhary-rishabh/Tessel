import { accessTokenParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import type { AccessTokensService } from "./access-tokens.service";
import { withUserContext, type Database } from "@tessel/db";

function actorFor(req: Request) {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId };
}

/** Routes under /workspaces/:workspaceId/access-tokens, for the signed-in user's own tokens. */
export function createAccessTokensRouter({
  service,
  authenticate,
}: {
  service: AccessTokensService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json({ tokens: await service.list(actorFor(req)) });
  });
  router.post("/", async (req, res) => {
    res.status(201).json(await service.create(actorFor(req), req.body));
  });
  router.delete("/:tokenId", async (req, res) => {
    const { tokenId } = accessTokenParamsSchema.parse(req.params);
    await service.revoke(actorFor(req), tokenId);
    res.status(204).end();
  });
  return router;
}

/**
 * GET /access-tokens/current: what the presented token is for. Lets an
 * outside client (the MCP server) learn its workspace from the token alone.
 */
export function createCurrentTokenRouter({
  db,
  authenticate,
}: {
  db: Database;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.get("/current", authenticate, async (req, res) => {
    const auth = getAuth(req);
    if (!auth.token)
      throw errors.badRequest("not_a_token", "Call this with a personal access token");
    const workspace = await withUserContext(db, auth.userId, (tx) =>
      workspacesRepository.findForUser(tx, auth.token!.workspaceId, auth.userId),
    );
    if (!workspace) throw errors.notFound("Workspace not found");
    res.json({
      workspace: { id: workspace.id, name: workspace.name },
      scopes: auth.token.scopes,
    });
  });
  return router;
}
