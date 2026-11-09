import { connectionParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import {
  Router,
  type CookieOptions,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { getAuth } from "../../middleware/require-auth";
import { hashToken } from "../auth/tokens";
import { CONNECTOR_STATE_TTL_MS, type Actor, type ConnectorsService } from "./connectors.service";

/**
 * Ties an app sign-in to the browser that started it: the callback only
 * finishes when this cookie matches the returned state. Without it, someone
 * could send their own sign-in link to another person and get that person's
 * account connected to their connector.
 */
const BINDING_COOKIE = "tessel_connector_oauth";
const bindingCookie = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  secure,
  // Lax: the browser comes back from the app's own site with a top-level redirect.
  sameSite: "lax",
  path: "/connectors/oauth",
});

function bindSignIn(res: Response, authorizationUrl: string | null, secure: boolean) {
  if (!authorizationUrl) return;
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (!state) return;
  res.cookie(BINDING_COOKIE, hashToken(state), {
    ...bindingCookie(secure),
    maxAge: CONNECTOR_STATE_TTL_MS,
  });
}

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

const connectionIdOf = (req: Request) => connectionParamsSchema.parse(req.params).connectionId;

/** Routes under /workspaces/:workspaceId/connectors. */
export function createConnectorsRouter({
  service,
  authenticate,
  cookieSecure,
}: {
  service: ConnectorsService;
  authenticate: RequestHandler;
  cookieSecure: boolean;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json(await service.list(actorFor(req)));
  });
  router.post("/", async (req, res) => {
    const created = await service.create(actorFor(req), req.body);
    bindSignIn(res, created.authorizationUrl, cookieSecure);
    res.status(201).json(created);
  });
  router.post("/:connectionId/refresh", async (req, res) => {
    const refreshed = await service.refresh(actorFor(req), connectionIdOf(req));
    bindSignIn(res, refreshed.authorizationUrl, cookieSecure);
    res.json(refreshed);
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
export function createConnectorCallbackRouter({
  service,
  cookieSecure,
}: {
  service: ConnectorsService;
  cookieSecure: boolean;
}): Router {
  const router = Router();
  router.get("/oauth/callback", async (req, res) => {
    const param = (name: string) =>
      typeof req.query[name] === "string" ? (req.query[name] as string) : undefined;
    const state = param("state");
    const code = param("code");
    const error = param("error");
    const binding: unknown = req.cookies?.[BINDING_COOKIE];
    const target = await service.finishOAuth({
      ...(state ? { state } : {}),
      ...(code ? { code } : {}),
      ...(error ? { error } : {}),
      ...(typeof binding === "string" ? { binding } : {}),
    });
    res.clearCookie(BINDING_COOKIE, bindingCookie(cookieSecure));
    res.redirect(302, target);
  });
  return router;
}
