import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AuthResponse,
  LoginRequest,
  ResetPasswordRequest,
  Session,
  SignupRequest,
  SignupStartedResponse,
  TwoFactorLoginRequest,
  VerifySignupRequest,
} from "@tessel/contracts";
import {
  passwordResets,
  recoveryCodes,
  refreshTokens,
  signupChallenges,
  users,
  type Database,
  type UserRow,
} from "@tessel/db";
import type { SecretBox } from "@tessel/mcp";
import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Logger } from "@tessel/logger";
import { AppError, errors, isUniqueViolation } from "../../lib/errors";
import { usersRepository } from "../users/users.repository";
import { toPublicUser } from "../users/users.mapper";
import { createAccount } from "./accounts";
import { refreshTokenRepository } from "./auth.repository";
import type { PasswordHasher } from "./password";
import { emails, type Mailer } from "../../lib/mailer";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { generateRefreshToken, hashToken, type AccessTokens } from "./tokens";
import { verifyTotp } from "./totp";

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
  mailer: Mailer;
  /** The web app, for links in emails. */
  webOrigin: string;
  /** Decrypts two-factor secrets. */
  box: SecretBox;
  audit?: AuditRecorder;
  now?: () => Date;
}

/** How the first sign-in step was passed, for the audit log. */
export type SignInMethod = "password" | "google" | "github" | "phone";

/** Login either signs in, or asks for the second factor first. */
export type LoginOutcome =
  { kind: "session"; session: IssuedSession } | { kind: "two_factor"; challengeToken: string };

const SIGNUP_CODE_TTL_MS = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const RESET_TTL_MS = 30 * 60_000;

const INVALID_CODE = () =>
  errors.badRequest(
    "invalid_code",
    "That code is wrong or has expired. Check the newest email, or start again.",
  );
const INVALID_RESET = () =>
  errors.badRequest(
    "invalid_reset_link",
    "This link has expired or was already used. Ask for a new one.",
  );
const INVALID_TWO_FACTOR = () =>
  errors.unauthorized(
    "invalid_two_factor_code",
    "That code didn't work. Try the newest one from your app.",
  );

const codeHash = (challengeId: string, code: string) =>
  createHash("sha256").update(`${challengeId}:${code}`).digest("hex");

const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Recovery codes ignore case, spaces, and dashes when checked. */
export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecoveryCode = (code: string) =>
  createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");

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
  mailer,
  webOrigin,
  box,
  audit = noAudit,
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

  /**
   * Signs a user in after their first factor (password, Google, GitHub, or a
   * texted code), or asks for their authenticator code first.
   */
  async function beginSession(
    user: UserRow,
    meta: SessionMeta,
    method: SignInMethod = "password",
  ): Promise<LoginOutcome> {
    if (user.totpEnabledAt) {
      return {
        kind: "two_factor",
        challengeToken: await accessTokens.signTwoFactorChallenge(user.id),
      };
    }
    await usersRepository.touchLastLogin(db, user.id, now());
    await audit.record({
      actorId: user.id,
      action: "auth.signed_in",
      metadata: { method },
      ipAddress: meta.ipAddress,
    });
    return { kind: "session", session: await issueSession(user, meta) };
  }

  return {
    /**
     * Starts a signup: nothing is created until the emailed code is entered.
     * The answer is the same whether or not the email has an account.
     */
    async startSignup(input: SignupRequest): Promise<SignupStartedResponse> {
      const passwordHash = await passwords.hash(input.password);
      const existing = await usersRepository.findByEmail(db, input.email);
      const challengeId = randomUUID();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await db.insert(signupChallenges).values({
        id: challengeId,
        email: input.email,
        name: input.name,
        passwordHash,
        codeHash: existing ? null : codeHash(challengeId, code),
        expiresAt: new Date(now().getTime() + SIGNUP_CODE_TTL_MS),
      });
      await mailer.send(
        existing
          ? emails.accountExists(input.email, webOrigin)
          : emails.signupCode(input.email, code),
      );
      return { status: "verification_sent", challengeId };
    },

    /** Sends the code again (or the "you already have an account" note). */
    async resendSignup(challengeId: string): Promise<SignupStartedResponse> {
      const [challenge] = await db
        .select()
        .from(signupChallenges)
        .where(and(eq(signupChallenges.id, challengeId), gt(signupChallenges.expiresAt, now())));
      if (!challenge) throw INVALID_CODE();
      if (!challenge.codeHash) {
        await mailer.send(emails.accountExists(challenge.email, webOrigin));
      } else {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await db
          .update(signupChallenges)
          .set({
            codeHash: codeHash(challengeId, code),
            expiresAt: new Date(now().getTime() + SIGNUP_CODE_TTL_MS),
          })
          .where(eq(signupChallenges.id, challengeId));
        await mailer.send(emails.signupCode(challenge.email, code));
      }
      return { status: "verification_sent", challengeId };
    },

    /** Finishes a signup with its code: creates the account (email verified) and its personal workspace. */
    async verifySignup(input: VerifySignupRequest, meta: SessionMeta): Promise<IssuedSession> {
      const outcome = await db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(signupChallenges)
          .where(eq(signupChallenges.id, input.challengeId))
          .for("update");
        if (!challenge || challenge.expiresAt <= now() || challenge.attempts >= MAX_CODE_ATTEMPTS) {
          return { kind: "invalid" as const };
        }
        if (
          !challenge.codeHash ||
          !sameHash(challenge.codeHash, codeHash(challenge.id, input.code))
        ) {
          await tx
            .update(signupChallenges)
            .set({ attempts: challenge.attempts + 1 })
            .where(eq(signupChallenges.id, challenge.id));
          return { kind: "invalid" as const };
        }
        try {
          const created = await createAccount(tx, {
            email: challenge.email,
            name: challenge.name,
            passwordHash: challenge.passwordHash,
            emailVerifiedAt: now(),
          });
          await tx.delete(signupChallenges).where(eq(signupChallenges.email, challenge.email));
          return { kind: "created" as const, user: created };
        } catch (error) {
          // Two signups for the same email raced; the other one won.
          if (isUniqueViolation(error, "users_email_unique")) return { kind: "invalid" as const };
          throw error;
        }
      });
      if (outcome.kind === "invalid") throw INVALID_CODE();
      logger.info({ userId: outcome.user.id }, "User signed up");
      await audit.record({
        actorId: outcome.user.id,
        action: "auth.signed_up",
        metadata: { method: "email" },
        ipAddress: meta.ipAddress,
      });
      return issueSession(outcome.user, meta);
    },

    async login(input: LoginRequest, meta: SessionMeta): Promise<LoginOutcome> {
      const user = await usersRepository.findByEmail(db, input.email);
      const valid = user?.passwordHash
        ? await passwords.verify(user.passwordHash, input.password)
        : await passwords.verifyNothing(input.password);
      if (!user || !valid) {
        throw INVALID_CREDENTIALS();
      }
      return beginSession(user, meta);
    },

    beginSession,

    /** The second sign-in step: an authenticator code, or a one-time recovery code. */
    async completeTwoFactor(
      input: TwoFactorLoginRequest,
      meta: SessionMeta,
    ): Promise<IssuedSession> {
      let userId: string;
      try {
        userId = await accessTokens.verifyTwoFactorChallenge(input.challengeToken);
      } catch {
        throw errors.unauthorized(
          "two_factor_expired",
          "This sign-in took too long. Enter your password again.",
        );
      }
      const user = await usersRepository.findById(db, userId);
      if (!user?.totpSecret || !user.totpEnabledAt) throw INVALID_TWO_FACTOR();

      if (input.code) {
        const step = verifyTotp(box.open<string>(user.totpSecret), input.code, {
          at: now(),
          lastStep: user.totpLastStep,
        });
        if (step === null) throw INVALID_TWO_FACTOR();
        // Only one request can move the step forward, so a code works once.
        const claimed = await db
          .update(users)
          .set({ totpLastStep: step })
          .where(
            and(
              eq(users.id, user.id),
              or(isNull(users.totpLastStep), lt(users.totpLastStep, step)),
            ),
          )
          .returning({ id: users.id });
        if (claimed.length === 0) throw INVALID_TWO_FACTOR();
      } else if (input.recoveryCode) {
        const used = await db
          .update(recoveryCodes)
          .set({ usedAt: now() })
          .where(
            and(
              eq(recoveryCodes.userId, user.id),
              eq(recoveryCodes.codeHash, hashRecoveryCode(input.recoveryCode)),
              isNull(recoveryCodes.usedAt),
            ),
          )
          .returning({ id: recoveryCodes.id });
        if (used.length === 0) throw INVALID_TWO_FACTOR();
        logger.info({ userId: user.id }, "Signed in with a recovery code");
      }
      await usersRepository.touchLastLogin(db, user.id, now());
      await audit.record({
        actorId: user.id,
        action: "auth.signed_in",
        metadata: { secondStep: input.code ? "authenticator" : "recovery_code" },
        ipAddress: meta.ipAddress,
      });
      return issueSession(user, meta);
    },

    /** Emails a reset link if the account exists; answers the same either way. */
    async forgotPassword(email: string): Promise<void> {
      const user = await usersRepository.findByEmail(db, email);
      if (!user) return;
      const token = randomBytes(32).toString("base64url");
      await db.transaction(async (tx) => {
        // Only the newest link works.
        await tx
          .update(passwordResets)
          .set({ usedAt: now() })
          .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
        await tx.insert(passwordResets).values({
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(now().getTime() + RESET_TTL_MS),
        });
      });
      await mailer.send(
        emails.passwordReset(user.email, `${webOrigin}/reset-password?token=${token}`),
      );
    },

    /**
     * Sets a new password from a reset link, signs out every session, and
     * marks the email verified (the link proved it). Two-step sign-in still
     * applies at the next login.
     */
    async resetPassword(input: ResetPasswordRequest, meta: SessionMeta = {}): Promise<void> {
      const passwordHash = await passwords.hash(input.password);
      const user = await db.transaction(async (tx) => {
        const [reset] = await tx
          .update(passwordResets)
          .set({ usedAt: now() })
          .where(
            and(
              eq(passwordResets.tokenHash, hashToken(input.token)),
              isNull(passwordResets.usedAt),
              gt(passwordResets.expiresAt, now()),
            ),
          )
          .returning();
        if (!reset) return undefined;
        const [updated] = await tx
          .update(users)
          .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
          .where(eq(users.id, reset.userId))
          .returning();
        await refreshTokenRepository.revokeAllForUser(tx, reset.userId, now());
        return updated;
      });
      if (!user) throw INVALID_RESET();
      logger.info({ userId: user.id }, "Password reset; all sessions revoked");
      await audit.record({
        actorId: user.id,
        action: "auth.password_reset",
        ipAddress: meta.ipAddress,
      });
      await mailer.send(emails.passwordChanged(user.email));
    },

    /** The user's signed-in browsers and devices, newest activity first. */
    async listSessions(userId: string, currentToken: string | undefined): Promise<Session[]> {
      const rows = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.userId, userId))
        .orderBy(asc(refreshTokens.createdAt));
      const currentHash = currentToken ? hashToken(currentToken) : null;
      const families = new Map<string, { started: Date; active?: (typeof rows)[number] }>();
      for (const row of rows) {
        const family = families.get(row.familyId) ?? { started: row.createdAt };
        if (!row.revokedAt && row.expiresAt > now()) family.active = row;
        families.set(row.familyId, family);
      }
      return [...families.entries()]
        .filter(([, family]) => family.active)
        .map(([id, family]) => ({
          id,
          userAgent: family.active!.userAgent ?? null,
          ipAddress: family.active!.ipAddress ?? null,
          createdAt: family.started.toISOString(),
          lastUsedAt: family.active!.createdAt.toISOString(),
          current: family.active!.tokenHash === currentHash,
        }))
        .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    },

    /** Signs one session out everywhere it's used. */
    async revokeSession(userId: string, sessionId: string, meta: SessionMeta = {}): Promise<void> {
      const revoked = await db
        .update(refreshTokens)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            eq(refreshTokens.familyId, sessionId),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id });
      if (revoked.length === 0) throw errors.notFound("Session not found");
      await audit.record({
        actorId: userId,
        action: "auth.session_revoked",
        target: `session:${sessionId}`,
        ipAddress: meta.ipAddress,
      });
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

      const valid = user.passwordHash
        ? await passwords.verify(user.passwordHash, input.currentPassword)
        : false;
      if (!valid) {
        throw errors.badRequest("invalid_current_password", "Current password is incorrect");
      }

      const passwordHash = await passwords.hash(input.newPassword);
      await db.transaction(async (tx) => {
        await usersRepository.updatePassword(tx, user.id, passwordHash);
        await refreshTokenRepository.revokeAllForUser(tx, user.id, now());
      });
      logger.info({ userId }, "Password changed; all sessions revoked");
      await audit.record({
        actorId: userId,
        action: "auth.password_changed",
        ipAddress: meta.ipAddress,
      });
      await mailer.send(emails.passwordChanged(user.email));
      return issueSession({ ...user, passwordHash }, meta);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
