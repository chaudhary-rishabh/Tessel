import { connectionParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, ConnectorsService } from "./connectors.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

const connectionIdOf = (req: Request) => connectionParamsSchema.parse(req.params).connectionId;

/** Routes under /workspaces/:workspaceId/connectors. */
export function createConnectorsRouter({
  service,
  authenticate,
}: {
  service: ConnectorsService;
  authenticate: RequestHandler;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json(await service.list(actorFor(req)));
  });
  router.post("/", async (req, res) => {
    res.status(201).json(await service.create(actorFor(req), req.body));
  });
  router.post("/:connectionId/refresh", async (req, res) => {
    res.json(await service.refresh(actorFor(req), connectionIdOf(req)));
  });
  router.patch("/:connectionId", async (req, res) => {
    res.json(await service.update(actorFor(req), connectionIdOf(req), req.body));
  });
  router.delete("/:connectionId", async (req, res) => {
    await service.remove(actorFor(req), connectionIdOf(req));
    res.status(204).end();
  });
  return router;
}

/**
 * GET /connectors/oauth/callback: where an app's sign-in page sends the
 * browser back. It carries no session, so the single-use state finds the
 * connection; the browser then goes back to the Connectors page.
 */
export function createConnectorCallbackRouter({ service }: { service: ConnectorsService }): Router {
  const router = Router();
  router.get("/oauth/callback", async (req, res) => {
    const param = (name: string) =>
      typeof req.query[name] === "string" ? (req.query[name] as string) : undefined;
    const state = param("state");
    const code = param("code");
    const error = param("error");
    const target = await service.finishOAuth({
      ...(state ? { state } : {}),
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
    });
    res.redirect(302, target);
  });
  return router;
}
