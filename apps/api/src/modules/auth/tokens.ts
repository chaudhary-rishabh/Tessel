import { createHash, randomBytes, randomUUID } from "node:crypto";
import { userRoleSchema } from "@tessel/contracts";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { AuthContext } from "../../types/express";

const ISSUER = "tessel-api";
const AUDIENCE = "tessel";
const ALGORITHM = "HS256";

const claimsSchema = z.object({ sub: z.uuid(), role: userRoleSchema });

export interface AccessTokens {
  readonly ttlSeconds: number;
  sign(context: AuthContext): Promise<string>;
  verify(token: string): Promise<AuthContext>;
  /** A five-minute token proving the password was right, for the second sign-in step. */
  signTwoFactorChallenge(userId: string): Promise<string>;
  /** The user the challenge is for; throws if it's invalid or expired. */
  verifyTwoFactorChallenge(token: string): Promise<string>;
}

const TWO_FACTOR_AUDIENCE = "tessel-two-factor";
const TWO_FACTOR_TTL = "5m";

/** Short-lived, stateless access tokens (JWT, HS256). */
export function createAccessTokens({
  secret,
  ttlSeconds,
}: {
  secret: string;
  ttlSeconds: number;
}): AccessTokens {
  const key = new TextEncoder().encode(secret);

  return {
    ttlSeconds,
    sign: ({ userId, role }) =>
      new SignJWT({ role })
        .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(key),
    verify: async (token) => {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 5,
      });
      const claims = claimsSchema.parse(payload);
      return { userId: claims.sub, role: claims.role };
    },
    signTwoFactorChallenge: (userId) =>
      new SignJWT({})
        .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(TWO_FACTOR_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(TWO_FACTOR_TTL)
        .sign(key),
    verifyTwoFactorChallenge: async (token) => {
      const { payload } = await jwtVerify(token, key, {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: TWO_FACTOR_AUDIENCE,
      });
      return z.uuid().parse(payload.sub);
    },
  };
}

/** SHA-256 hex digest. Refresh tokens are stored only in this form. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new opaque refresh token (256 bits of randomness) and its hash. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}
