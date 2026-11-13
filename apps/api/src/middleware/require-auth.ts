import type { AccessTokenScope } from "@tessel/contracts";
import type { Request, RequestHandler } from "express";
import { errors } from "../lib/errors";
import type { TokenIdentity } from "../modules/access-tokens/access-tokens.service";
import type { SessionTokens } from "../modules/auth/tokens";
import type { AuthContext } from "../types/express";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A route personal access tokens may call, and the scope it needs. */
export interface TokenRoute {
  method: "GET" | "POST";
  /** Matched against the full path; the first capture, if any, is the workspace ID. */
  path: RegExp;
  scope: AccessTokenScope | null;
}

/**
 * Everything a personal access token can reach. Anything not listed is
 * refused, so new routes stay closed to tokens until they're added here.
 */
export const TOKEN_ROUTES: TokenRoute[] = [
  { method: "GET", path: /^\/access-tokens\/current$/, scope: null },
  { method: "GET", path: new RegExp(`^/workspaces/(${UUID})/documents$`), scope: "documents:read" },
  {
    method: "GET",
    path: new RegExp(`^/workspaces/(${UUID})/documents/${UUID}$`),
    scope: "documents:read",
  },
  {
    method: "GET",
    path: new RegExp(`^/workspaces/(${UUID})/documents/${UUID}/text$`),
    scope: "documents:read",
  },
  { method: "POST", path: new RegExp(`^/workspaces/(${UUID})/search$`), scope: "documents:read" },
  {
    method: "POST",
    path: new RegExp(`^/workspaces/(${UUID})/documents/text$`),
    scope: "documents:write",
  },
  { method: "POST", path: new RegExp(`^/workspaces/(${UUID})/chat$`), scope: "chat:write" },
];

export type ResolveToken = (token: string) => Promise<TokenIdentity | null>;

function tokenAccess(req: Request, identity: TokenIdentity): void {
  const path = req.originalUrl.split("?")[0]!.replace(/\/+$/, "");
  const route = TOKEN_ROUTES.find((item) => item.method === req.method && item.path.test(path));
  if (!route) {
    throw errors.forbidden("Personal access tokens can't be used for this");
  }
  const workspaceId = route.path.exec(path)?.[1];
  if (workspaceId && workspaceId !== identity.workspaceId) {
    throw errors.forbidden("This token belongs to a different workspace");
  }
  if (route.scope && !identity.scopes.includes(route.scope)) {
    throw errors.forbidden(`This token needs the ${route.scope} scope`);
  }
}

/**
 * Rejects requests without a valid `Authorization: Bearer` header: an access
 * token from signing in, or a personal access token (`tsl_pat_…`) or an
 * OAuth client's token (`tsl_oat_…`) on the routes in TOKEN_ROUTES.
 */
export function requireAuth(
  sessionTokens: SessionTokens,
  resolveToken?: ResolveToken,
): RequestHandler {
  return async (req, _res, next) => {
    // Routers mounted on the same path each authenticate; once is enough.
    if (req.auth) return next();
    const match = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) {
      throw errors.unauthorized();
    }
    const presented = match[1];
    if (resolveToken && (presented.startsWith("tsl_pat_") || presented.startsWith("tsl_oat_"))) {
      const identity = await resolveToken(presented);
      if (!identity)
        throw errors.unauthorized("invalid_token", "Invalid, expired, or revoked token");
      tokenAccess(req, identity);
      req.auth = {
        userId: identity.userId,
        role: identity.role,
        token: { id: identity.tokenId, workspaceId: identity.workspaceId, scopes: identity.scopes },
      };
      return next();
    }
    try {
      req.auth = await sessionTokens.verify(presented);
    } catch {
      throw errors.unauthorized("invalid_token", "Invalid or expired access token");
    }
    next();
  };
}

/** Reads the auth context on routes behind requireAuth. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw errors.unauthorized();
  }
  return req.auth;
}
