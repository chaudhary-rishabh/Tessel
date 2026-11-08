import { randomUUID } from "node:crypto";
import type { AuthResponse, LoginRequest, SignupRequest } from "@tessel/contracts";
import { setUserContext, type Database, type UserRow } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { AppError, errors, isUniqueViolation } from "../../lib/errors";
import { usersRepository } from "../users/users.repository";
import { toPublicUser } from "../users/users.mapper";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { refreshTokenRepository } from "./auth.repository";
import type { PasswordHasher } from "./password";
import { generateRefreshToken, hashToken, type AccessTokens } from "./tokens";

export interface SessionMeta {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
}

/** What a successful auth call produces: the response body and the cookie value. */
export interface IssuedSession {
  auth: AuthResponse;
  refreshToken: string;
}

export interface AuthServiceDependencies {
  db: Database;
  logger: Logger;
  passwords: PasswordHasher;
  accessTokens: AccessTokens;
  refreshTokenTtlMs: number;
  refreshRotationGraceMs: number;
  now?: () => Date;
}

const INVALID_CREDENTIALS = () =>
  errors.unauthorized("invalid_credentials", "Email or password is incorrect");
const INVALID_REFRESH = () =>
  errors.unauthorized("invalid_refresh_token", "Your session has ended. Please log in again.");

type RefreshOutcome =
  | { kind: "ok"; session: IssuedSession }
  | { kind: "invalid" }
  | { kind: "rotated_recently" }
  | { kind: "reused"; familyId: string; userId: string };

export function createAuthService({
  db,
  logger,
  passwords,
  accessTokens,
  refreshTokenTtlMs,
  refreshRotationGraceMs,
  now = () => new Date(),
}: AuthServiceDependencies) {
  async function buildAuthResponse(user: UserRow): Promise<AuthResponse> {
    return {
      accessToken: await accessTokens.sign({ userId: user.id, role: user.role }),
      tokenType: "Bearer",
      expiresIn: accessTokens.ttlSeconds,
      user: toPublicUser(user),
    };
  }

  /** Starts a new login session (a new refresh token family). */
  async function issueSession(user: UserRow, meta: SessionMeta): Promise<IssuedSession> {
    const refresh = generateRefreshToken();
    await refreshTokenRepository.insert(db, {
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: refresh.hash,
      expiresAt: new Date(now().getTime() + refreshTokenTtlMs),
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    });
    return { auth: await buildAuthResponse(user), refreshToken: refresh.token };
  }

  return {
    /** Creates the account and its personal workspace in one transaction. */
    async signup(input: SignupRequest, meta: SessionMeta): Promise<IssuedSession> {
      const passwordHash = await passwords.hash(input.password);
      let user: UserRow;
      try {
        user = await db.transaction(async (tx) => {
          const created = await usersRepository.insert(tx, {
            email: input.email,
            name: input.name,
            passwordHash,
          });
          // Act as the new user so row-level security allows creating their workspace.
          await setUserContext(tx, created.id);
          await workspacesRepository.createWithOwner(tx, {
            name: `${input.name.split(/\s+/)[0]}'s workspace`,
            ownerId: created.id,
            isPersonal: true,
          });
          return created;
        });
      } catch (error) {
        if (isUniqueViolation(error, "users_email_unique")) {
          throw errors.conflict("email_taken", "An account with this email already exists");
        }
        throw error;
      }
      logger.info({ userId: user.id }, "User signed up");
      return issueSession(user, meta);
    },

    async login(input: LoginRequest, meta: SessionMeta): Promise<IssuedSession> {
      const user = await usersRepository.findByEmail(db, input.email);
      const valid = user
        ? await passwords.verify(user.passwordHash, input.password)
        : await passwords.verifyNothing(input.password);
      if (!user || !valid) {
        throw INVALID_CREDENTIALS();
      }
      await usersRepository.touchLastLogin(db, user.id, now());
      return issueSession(user, meta);
    },

    /**
     * Rotates the refresh token: the presented token is retired and a new one
     * is issued in the same family. Presenting a retired token again means it
     * was copied, so the whole session is revoked. The one exception is a very
     * recent rotation, which is almost always two tabs refreshing at once.
     */
    async refresh(token: string, meta: SessionMeta): Promise<IssuedSession> {
      const at = now();
      const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
        const current = await refreshTokenRepository.findByHashForUpdate(tx, hashToken(token));
        if (!current) return { kind: "invalid" };

        if (current.revokedAt) {
          const age = at.getTime() - current.revokedAt.getTime();
          if (current.replacedById && age >= 0 && age < refreshRotationGraceMs) {
            return { kind: "rotated_recently" };
          }
          return { kind: "reused", familyId: current.familyId, userId: current.userId };
        }
        if (current.expiresAt <= at) return { kind: "invalid" };

        const user = await usersRepository.findById(tx, current.userId);
        if (!user) return { kind: "invalid" };

        const next = generateRefreshToken();
        const created = await refreshTokenRepository.insert(tx, {
          userId: user.id,
          familyId: current.familyId,
          tokenHash: next.hash,
          expiresAt: new Date(at.getTime() + refreshTokenTtlMs),
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        });
        await refreshTokenRepository.markRotated(tx, current.id, created.id, at);
        return {
          kind: "ok",
          session: { auth: await buildAuthResponse(user), refreshToken: next.token },
        };
      });

      switch (outcome.kind) {
        case "ok":
          return outcome.session;
        case "rotated_recently":
          throw new AppError(
            401,
            "refresh_token_rotated",
            "This session was just refreshed. Retry the request.",
          );
        case "reused":
          // Revoke outside the transaction above so the revocation is committed.
          await refreshTokenRepository.revokeFamily(db, outcome.familyId, at);
          logger.warn(
            { userId: outcome.userId, familyId: outcome.familyId },
            "Refresh token reuse detected; session revoked",
          );
          throw INVALID_REFRESH();
        case "invalid":
          throw INVALID_REFRESH();
      }
    },

    /** Ends the session the token belongs to. Safe to call with an unknown token. */
    async logout(token: string | undefined): Promise<void> {
      if (!token) return;
      const current = await refreshTokenRepository.findByHash(db, hashToken(token));
      if (current) {
        await refreshTokenRepository.revokeFamily(db, current.familyId, now());
      }
    },

    /** Changes the password, ends every existing session, and starts a new one. */
    async changePassword(
      userId: string,
      input: { currentPassword: string; newPassword: string },
      meta: SessionMeta,
    ): Promise<IssuedSession> {
      const user = await usersRepository.findById(db, userId);
      if (!user) throw errors.unauthorized();

      const valid = await passwords.verify(user.passwordHash, input.currentPassword);
      if (!valid) {
        throw errors.badRequest("invalid_current_password", "Current password is incorrect");
      }

      const passwordHash = await passwords.hash(input.newPassword);
      await db.transaction(async (tx) => {
        await usersRepository.updatePassword(tx, user.id, passwordHash);
        await refreshTokenRepository.revokeAllForUser(tx, user.id, now());
      });
      logger.info({ userId }, "Password changed; all sessions revoked");
      return issueSession({ ...user, passwordHash }, meta);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
