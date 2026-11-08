import { loginRequestSchema, signupRequestSchema } from "@tessel/contracts";
import type { RequestHandler } from "express";
import { AppError, errors } from "../../lib/errors";
import type { AuthService } from "./auth.service";
import type { RefreshCookie } from "./cookies";
import { sessionMeta } from "./session-meta";

export function createAuthController(service: AuthService, cookie: RefreshCookie) {
  const signup: RequestHandler = async (req, res) => {
    const input = signupRequestSchema.parse(req.body);
    const { auth, refreshToken } = await service.signup(input, sessionMeta(req));
    cookie.set(res, refreshToken);
    res.status(201).json(auth);
  };

  const login: RequestHandler = async (req, res) => {
    const input = loginRequestSchema.parse(req.body);
    const { auth, refreshToken } = await service.login(input, sessionMeta(req));
    cookie.set(res, refreshToken);
    res.json(auth);
  };

  const refresh: RequestHandler = async (req, res) => {
    const token = cookie.read(req);
    if (!token) {
      throw errors.unauthorized("missing_refresh_token", "No active session");
    }
    try {
      const { auth, refreshToken } = await service.refresh(token, sessionMeta(req));
      cookie.set(res, refreshToken);
      res.json(auth);
    } catch (error) {
      // A dead session's cookie is useless; clear it so clients stop retrying.
      if (error instanceof AppError && error.code === "invalid_refresh_token") {
        cookie.clear(res);
      }
      throw error;
    }
  };

  const logout: RequestHandler = async (req, res) => {
    await service.logout(cookie.read(req));
    cookie.clear(res);
    res.status(204).end();
  };

  return { signup, login, refresh, logout };
}
