import { randomBytes } from "node:crypto";
import type { TwoFactorSetupResponse } from "@tessel/contracts";
import { recoveryCodes, users, type Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import type { SecretBox } from "@tessel/mcp";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { errors } from "../../lib/errors";
import { emails, type Mailer } from "../../lib/mailer";
import { usersRepository } from "../users/users.repository";
import { hashRecoveryCode } from "./auth.service";
import type { PasswordHasher } from "./password";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp";

const RECOVERY_CODES = 10;

/** "k3vq8-2mtx9": ten characters of base36 in two groups, about 51 bits each. */
function newRecoveryCode(): string {
  const text = BigInt(`0x${randomBytes(8).toString("hex")}`)
    .toString(36)
    .padStart(10, "0")
    .slice(-10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

const INVALID_CODE = () =>
  errors.badRequest(
    "invalid_two_factor_code",
    "That code didn't work. Try the newest one from your app.",
  );

/**
 * Turning two-step sign-in on and off. The secret is confirmed with a code
 * before it's used, is stored encrypted, and changes are emailed to the user.
 */
export function createTwoFactorService({
  db,
  box,
  passwords,
  mailer,
  logger,
}: {
  db: Database;
  box: SecretBox;
  passwords: PasswordHasher;
  mailer: Mailer;
  logger: Logger;
}) {
  async function load(userId: string) {
    const user = await usersRepository.findById(db, userId);
    if (!user) throw errors.unauthorized();
    return user;
  }

  async function replaceRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
    await db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx
        .insert(recoveryCodes)
        .values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
    });
    return codes;
  }

  /** Checks a code against the active secret and records its step so it can't be reused. */
  async function checkActiveCode(user: Awaited<ReturnType<typeof load>>, code: string) {
    if (!user.totpSecret)
      throw errors.conflict("two_factor_not_enabled", "Two-step sign-in isn't on");
    const step = verifyTotp(box.open<string>(user.totpSecret), code, {
      lastStep: user.totpLastStep,
    });
    if (step === null) throw INVALID_CODE();
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  }

  return {
    /** A new secret to scan, kept pending until it's confirmed. */
    async setup(userId: string): Promise<TwoFactorSetupResponse> {
      const user = await load(userId);
      if (user.totpEnabledAt)
        throw errors.conflict("two_factor_enabled", "Two-step sign-in is already on");
      const secret = generateTotpSecret();
      await db
        .update(users)
        .set({ totpPendingSecret: box.seal(secret) })
        .where(eq(users.id, user.id));
      const otpauthUrl = totpUri({ secret, account: user.email });
      return {
        secret,
        otpauthUrl,
        qrCode: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }),
      };
    },

    /** Confirms the pending secret with a code, turns it on, and returns recovery codes (shown once). */
    async enable(userId: string, code: string): Promise<string[]> {
      const user = await load(userId);
      if (user.totpEnabledAt)
        throw errors.conflict("two_factor_enabled", "Two-step sign-in is already on");
      if (!user.totpPendingSecret)
        throw errors.conflict("two_factor_not_set_up", "Start setting up two-step sign-in first");
      const step = verifyTotp(box.open<string>(user.totpPendingSecret), code);
      if (step === null) throw INVALID_CODE();
      await db
        .update(users)
        .set({
          totpSecret: user.totpPendingSecret,
          totpPendingSecret: null,
          totpEnabledAt: new Date(),
          totpLastStep: step,
        })
        .where(eq(users.id, user.id));
      const codes = await replaceRecoveryCodes(user.id);
      logger.info({ userId }, "Two-step sign-in turned on");
      await mailer.send(emails.twoFactorChanged(user.email, true));
      return codes;
    },

    /** Turns it off, after the password (if the account has one) and a current code. */
    async disable(
      userId: string,
      input: { password?: string | undefined; code: string },
    ): Promise<void> {
      const user = await load(userId);
      if (user.passwordHash) {
        if (!input.password || !(await passwords.verify(user.passwordHash, input.password))) {
          throw errors.badRequest("invalid_current_password", "Current password is incorrect");
        }
      }
      await checkActiveCode(user, input.code);
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            totpSecret: null,
            totpPendingSecret: null,
            totpEnabledAt: null,
            totpLastStep: null,
          })
          .where(eq(users.id, user.id));
        await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      });
      logger.info({ userId }, "Two-step sign-in turned off");
      await mailer.send(emails.twoFactorChanged(user.email, false));
    },

    /** New recovery codes, replacing the old ones. */
    async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
      const user = await load(userId);
      await checkActiveCode(user, code);
      return replaceRecoveryCodes(user.id);
    },
  };
}

export type TwoFactorService = ReturnType<typeof createTwoFactorService>;
