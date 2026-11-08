import { changePasswordRequestSchema } from "@tessel/contracts";
import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { AuthService } from "../auth/auth.service";
import type { RefreshCookie } from "../auth/cookies";
import { sessionMeta } from "../auth/session-meta";
import type { UsersService } from "./users.service";

export function createUsersController(
  users: UsersService,
  auth: AuthService,
  cookie: RefreshCookie,
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

  return { getMe, changePassword };
}
