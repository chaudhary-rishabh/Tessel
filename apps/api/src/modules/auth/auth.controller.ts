import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resendSignupRequestSchema,
  resetPasswordRequestSchema,
  sessionParamsSchema,
  signupRequestSchema,
  twoFactorLoginRequestSchema,
  verifySignupRequestSchema,
  type TwoFactorRequired,
} from "@tessel/contracts";
import type { RequestHandler } from "express";
import { AppError, errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import type { AuthService } from "./auth.service";
import type { RefreshCookie } from "./cookies";
import { sessionMeta } from "./session-meta";

export function createAuthController(service: AuthService, cookie: RefreshCookie) {
  const signup: RequestHandler = async (req, res) => {
    res.status(202).json(await service.startSignup(signupRequestSchema.parse(req.body)));
  };

  const resendSignup: RequestHandler = async (req, res) => {
    const { challengeId } = resendSignupRequestSchema.parse(req.body);
    res.status(202).json(await service.resendSignup(challengeId));
  };

  const verifySignup: RequestHandler = async (req, res) => {
    const input = verifySignupRequestSchema.parse(req.body);
    const { auth, refreshToken } = await service.verifySignup(input, sessionMeta(req));
    cookie.set(res, refreshToken);
    res.status(201).json(auth);
  };

  const login: RequestHandler = async (req, res) => {
    const outcome = await service.login(loginRequestSchema.parse(req.body), sessionMeta(req));
    if (outcome.kind === "two_factor") {
      const body: TwoFactorRequired = {
        status: "two_factor_required",
        challengeToken: outcome.challengeToken,
      };
      res.json(body);
      return;
    }
    cookie.set(res, outcome.session.refreshToken);
    res.json(outcome.session.auth);
  };

  const twoFactor: RequestHandler = async (req, res) => {
    const input = twoFactorLoginRequestSchema.parse(req.body);
    const { auth, refreshToken } = await service.completeTwoFactor(input, sessionMeta(req));
    cookie.set(res, refreshToken);
    res.json(auth);
  };

  const forgotPassword: RequestHandler = async (req, res) => {
    const { email } = forgotPasswordRequestSchema.parse(req.body);
    await service.forgotPassword(email);
    res.status(202).json({ status: "sent" });
  };

  const resetPassword: RequestHandler = async (req, res) => {
    await service.resetPassword(resetPasswordRequestSchema.parse(req.body));
    cookie.clear(res);
    res.status(204).end();
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

  const listSessions: RequestHandler = async (req, res) => {
    res.json({ sessions: await service.listSessions(getAuth(req).userId, cookie.read(req)) });
  };

  const revokeSession: RequestHandler = async (req, res) => {
    const { sessionId } = sessionParamsSchema.parse(req.params);
    await service.revokeSession(getAuth(req).userId, sessionId);
    res.status(204).end();
  };

  return {
    signup,
    resendSignup,
    verifySignup,
    login,
    twoFactor,
    forgotPassword,
    resetPassword,
    refresh,
    logout,
    listSessions,
    revokeSession,
  };
}
