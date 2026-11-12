import {
  updateProfileRequestSchema,
  verifyEmailRequestSchema,
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

  const updateMe: RequestHandler = async (req, res) => {
    const input = updateProfileRequestSchema.parse(req.body);
    res.json(await users.updateProfile(getAuth(req).userId, input));
  };

  const verifyEmail: RequestHandler = async (req, res) => {
    const { token } = verifyEmailRequestSchema.parse(req.body);
    res.json(await auth.verifyEmail(getAuth(req).userId, token));
  };

  const resendEmailVerification: RequestHandler = async (req, res) => {
    await auth.resendEmailVerification(getAuth(req).userId);
    res.status(202).json({ status: "sent" });
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
    updateMe,
    verifyEmail,
    resendEmailVerification,
    changePassword,
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
    regenerateRecoveryCodes,
  };
}
