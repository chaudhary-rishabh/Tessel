import type { Request, RequestHandler } from "express";
import { errors } from "../lib/errors";
import type { AccessTokens } from "../modules/auth/tokens";
import type { AuthContext } from "../types/express";

/** Rejects requests without a valid `Authorization: Bearer <access token>` header. */
export function requireAuth(accessTokens: AccessTokens): RequestHandler {
  return async (req, _res, next) => {
    const match = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) {
      throw errors.unauthorized();
    }
    try {
      req.auth = await accessTokens.verify(match[1]);
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
