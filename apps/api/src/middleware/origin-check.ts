import type { RequestHandler } from "express";
import { errors } from "../lib/errors";

/**
 * Extra CSRF protection for cookie-authenticated routes: when a browser sends
 * an Origin header, it must be one of our web origins. Requests without an
 * Origin (server-to-server, curl) are allowed; the cookie is also SameSite=Strict.
 */
export function requireAllowedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.includes(origin)) {
      throw errors.forbidden("Request origin is not allowed");
    }
    next();
  };
}
