import { randomInt, randomUUID } from "node:crypto";
import type { PhoneCodeSentResponse, PhoneVerifyRequest, PublicUser } from "@tessel/contracts";
import { phoneChallenges, users, type Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { and, eq, isNotNull } from "drizzle-orm";
import { errors, isUniqueViolation } from "../../lib/errors";
import { emails, type Mailer } from "../../lib/mailer";
import { noAudit, type AuditRecorder } from "../../lib/audit";
import { texts, type SmsSender } from "../../lib/sms";
import { toPublicUser } from "../users/users.mapper";
import { usersRepository } from "../users/users.repository";
import type { LoginOutcome, SessionMeta, SignInMethod } from "./auth.service";
import { assertNotLastSignInMethod } from "./sign-in-methods";
import type { UserRow } from "@tessel/db";
import { hashCode, sameHash } from "./tokens";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

const INVALID_CODE = () =>
  errors.badRequest("invalid_code", "That code is wrong or has expired. Ask for a new one.");

/** For emails about a number, without repeating all of it. */
export const maskPhone = (phone: string) => `the phone number ending ${phone.slice(-4)}`;

export interface PhoneServiceDependencies {
  db: Database;
  logger: Logger;
  /** Without one, phone sign-in is off. */
  sms: SmsSender | undefined;
  mailer: Mailer;
  beginSession: (user: UserRow, meta: SessionMeta, method: SignInMethod) => Promise<LoginOutcome>;
  audit?: AuditRecorder;
  now?: () => Date;
}

/** Signing in with a texted code, and adding or removing the number that receives it. */
export function createPhoneService({
  db,
  logger,
  sms,
  mailer,
  beginSession,
  audit = noAudit,
  now = () => new Date(),
}: PhoneServiceDependencies) {
  function sender(): SmsSender {
    if (!sms) throw errors.notFound("Signing in with a phone isn't set up");
    return sms;
  }

  async function createChallenge(input: {
    purpose: "login" | "verify";
    phone: string;
    userId: string | undefined;
    send: boolean;
  }): Promise<PhoneCodeSentResponse> {
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db.insert(phoneChallenges).values({
      id: challengeId,
      purpose: input.purpose,
      phone: input.phone,
      userId: input.userId,
      codeHash: input.send ? hashCode(challengeId, code) : null,
      expiresAt: new Date(now().getTime() + CODE_TTL_MS),
    });
    if (input.send) await sender().send(texts.code(input.phone, code, input.purpose));
    return { status: "code_sent", challengeId };
  }

  /** Checks a code once; five wrong tries end the challenge. Returns the challenge when right. */
  async function consume(input: PhoneVerifyRequest, purpose: "login" | "verify") {
    return db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(phoneChallenges)
        .where(and(eq(phoneChallenges.id, input.challengeId), eq(phoneChallenges.purpose, purpose)))
        .for("update");
      if (!challenge || challenge.expiresAt <= now() || challenge.attempts >= MAX_ATTEMPTS) {
        return undefined;
      }
      if (
        !challenge.codeHash ||
        !sameHash(challenge.codeHash, hashCode(challenge.id, input.code))
      ) {
        await tx
          .update(phoneChallenges)
          .set({ attempts: challenge.attempts + 1 })
          .where(eq(phoneChallenges.id, challenge.id));
        return undefined;
      }
      await tx.delete(phoneChallenges).where(eq(phoneChallenges.id, challenge.id));
      return challenge;
    });
  }

  return {
    enabled: Boolean(sms),

    /**
     * Texts a sign-in code to a number with an account. The answer is the
     * same for numbers without one, which get no text.
     */
    async startLogin(phone: string): Promise<PhoneCodeSentResponse> {
      sender();
      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.phone, phone), isNotNull(users.phoneVerifiedAt)));
      return createChallenge({ purpose: "login", phone, userId: owner?.id, send: Boolean(owner) });
    },

    async verifyLogin(input: PhoneVerifyRequest, meta: SessionMeta): Promise<LoginOutcome> {
      const challenge = await consume(input, "login");
      const user = challenge?.userId
        ? await usersRepository.findById(db, challenge.userId)
        : undefined;
      // The number must still be this user's.
      if (!user || user.phone !== challenge?.phone || !user.phoneVerifiedAt) throw INVALID_CODE();
      return beginSession(user, meta, "phone");
    },

    /** Texts a code to confirm a number the signed-in user is adding. */
    async startVerify(userId: string, phone: string): Promise<PhoneCodeSentResponse> {
      sender();
      return createChallenge({ purpose: "verify", phone, userId, send: true });
    },

    async confirm(userId: string, input: PhoneVerifyRequest): Promise<PublicUser> {
      const challenge = await consume(input, "verify");
      if (!challenge || challenge.userId !== userId) throw INVALID_CODE();
      let updated: UserRow | undefined;
      try {
        [updated] = await db
          .update(users)
          .set({ phone: challenge.phone, phoneVerifiedAt: now() })
          .where(eq(users.id, userId))
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, "users_phone_unique")) {
          throw errors.conflict("phone_taken", "Another Tessel account already uses this number");
        }
        throw error;
      }
      if (!updated) throw errors.unauthorized();
      logger.info({ userId }, "Phone number added");
      await audit.record({
        actorId: userId,
        action: "auth.sign_in_method_added",
        metadata: { method: "phone" },
      });
      await mailer.send(emails.signInMethodAdded(updated.email, maskPhone(challenge.phone)));
      return toPublicUser(updated);
    },

    async remove(userId: string): Promise<PublicUser> {
      const user = await usersRepository.findById(db, userId);
      if (!user) throw errors.unauthorized();
      if (!user.phone) throw errors.notFound("No phone number is added");
      if (user.phoneVerifiedAt) await assertNotLastSignInMethod(db, user);
      const [updated] = await db
        .update(users)
        .set({ phone: null, phoneVerifiedAt: null })
        .where(eq(users.id, userId))
        .returning();
      await audit.record({
        actorId: userId,
        action: "auth.sign_in_method_removed",
        metadata: { method: "phone" },
      });
      return toPublicUser(updated!);
    },
  };
}

export type PhoneService = ReturnType<typeof createPhoneService>;
