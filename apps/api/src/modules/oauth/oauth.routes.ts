import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import {
  ACCESS_TOKEN_SCOPES,
  approveOAuthRequestSchema,
  connectedAppParamsSchema,
  oauthAuthorizationParamsSchema,
} from "@tessel/contracts";
import { Router, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { OAuthService } from "./oauth.service";

/**
 * The standard endpoints MCP clients use, at the API's root: metadata at
 * /.well-known/oauth-authorization-server, plus /register, /authorize,
 * /token, and /revoke. Mounted before CORS, since clients call them from
 * any origin (the SDK adds its own CORS headers and rate limits).
 */
export function createOAuthServerRouter({
  service,
  issuerUrl,
  resourceUrl,
}: {
  service: OAuthService;
  issuerUrl: string;
  resourceUrl: string;
}): RequestHandler {
  return mcpAuthRouter({
    provider: service.provider,
    issuerUrl: new URL(issuerUrl),
    resourceServerUrl: new URL(resourceUrl),
    scopesSupported: [...ACCESS_TOKEN_SCOPES],
    resourceName: "Tessel",
  });
}

/** For the consent page: describe, approve, or deny a client's sign-in. Signed-in users only. */
export function createOAuthConsentRouter({
  service,
  authenticate,
}: {
  service: OAuthService;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/:authorizationId", async (req, res) => {
    const { authorizationId } = oauthAuthorizationParamsSchema.parse(req.params);
    res.set("Cache-Control", "no-store").json(await service.describe(authorizationId));
  });
  router.post("/:authorizationId/approve", async (req, res) => {
    const { authorizationId } = oauthAuthorizationParamsSchema.parse(req.params);
    const { workspaceId, scopes } = approveOAuthRequestSchema.parse(req.body);
    const redirectUrl = await service.approve(
      getAuth(req).userId,
      authorizationId,
      workspaceId,
      scopes,
    );
    res.json({ redirectUrl });
  });
  router.post("/:authorizationId/deny", async (req, res) => {
    const { authorizationId } = oauthAuthorizationParamsSchema.parse(req.params);
    res.json({ redirectUrl: await service.deny(authorizationId) });
  });
  return router;
}

/** The signed-in user's connected MCP clients, under /users/me/connected-apps. */
export function createConnectedAppsRouter({
  service,
  authenticate,
}: {
  service: OAuthService;
  authenticate: RequestHandler;
}): Router {
  const router = Router();
  router.use(authenticate);
  router.get("/", async (req, res) => {
    res.json({ apps: await service.listApps(getAuth(req).userId) });
  });
  router.delete("/:appId", async (req, res) => {
    const { appId } = connectedAppParamsSchema.parse(req.params);
    await service.disconnect(getAuth(req).userId, appId);
    res.status(204).end();
  });
  return router;
}
