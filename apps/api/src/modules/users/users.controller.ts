import {
  changePasswordRequestSchema,
  disableTwoFactorRequestSchema,
  enableTwoFactorRequestSchema,
} from "@tessel/contracts";
import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { AuthService } from "../auth/auth.service";
import type { RefreshCookie } from "../auth/cookies";
import { sessionMeta } from "../auth/session-meta";
import type { TwoFactorService } from "../auth/two-factor.service";
import type { UsersService } from "./users.service";

export function createUsersController(
  users: UsersService,
  auth: AuthService,
  cookie: RefreshCookie,
  twoFactor: TwoFactorService,
) {
  const getMe: RequestHandler = async (req, res) => {
    res.json(await users.getMe(getAuth(req).userId));
  };

  const changePassword: RequestHandler = async (req, res) => {
    const input = changePasswordRequestSchema.parse(req.body);
    const session = await auth.changePassword(getAuth(req).userId, input, sessionMeta(req));
    cookie.set(res, session.refreshToken);
    res.json(session.auth);
  };

  const setupTwoFactor: RequestHandler = async (req, res) => {
    res.json(await twoFactor.setup(getAuth(req).userId));
  };

  const enableTwoFactor: RequestHandler = async (req, res) => {
    const { code } = enableTwoFactorRequestSchema.parse(req.body);
    res.json({ recoveryCodes: await twoFactor.enable(getAuth(req).userId, code) });
  };

  const disableTwoFactor: RequestHandler = async (req, res) => {
    await twoFactor.disable(getAuth(req).userId, disableTwoFactorRequestSchema.parse(req.body));
    res.status(204).end();
  };

  const regenerateRecoveryCodes: RequestHandler = async (req, res) => {
    const { code } = enableTwoFactorRequestSchema.parse(req.body);
    res.json({ recoveryCodes: await twoFactor.regenerateRecoveryCodes(getAuth(req).userId, code) });
  };

  return {
    getMe,
    changePassword,
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
    regenerateRecoveryCodes,
  };
}
