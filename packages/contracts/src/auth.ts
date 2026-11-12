import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema, publicUserSchema } from "./users";

/**
 * Signup creates the account and signs in straight away. The name comes from
 * the email until the user changes it in Settings; the email is confirmed
 * later from a link.
 */
export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

/** Login does not re-check password rules, only that something was sent. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});

/**
 * Returned by signup, login, refresh, and password change. The refresh token
 * is never in the body: it travels only in an httpOnly cookie.
 */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().positive(),
  user: publicUserSchema,
});

/** A six-digit code from an email or an authenticator app. */
export const oneTimeCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code"));

/** The link from the "confirm your email" message. */
export const verifyEmailRequestSchema = z.object({ token: z.string().min(20).max(200) });

/** Login answers with a session, or asks for a second factor first. */
export const twoFactorRequiredSchema = z.object({
  status: z.literal("two_factor_required"),
  /** Short-lived; send it back with the code. */
  challengeToken: z.string(),
});

export const twoFactorLoginRequestSchema = z
  .object({
    challengeToken: z.string().min(1).max(2_000),
    code: oneTimeCodeSchema.optional(),
    recoveryCode: z.string().trim().min(8).max(32).optional(),
  })
  .refine((value) => value.code || value.recoveryCode, {
    message: "Enter the code from your authenticator app or a recovery code",
    path: ["code"],
  });

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

/** A signed-in browser or device: one refresh token family. */
export const sessionSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** The session making this request. */
  current: z.boolean(),
});

export const sessionListResponseSchema = z.object({ sessions: z.array(sessionSchema) });
export const sessionParamsSchema = z.object({ sessionId: z.uuid("Invalid session ID") });

export const twoFactorSetupResponseSchema = z.object({
  /** For typing into an authenticator app by hand. */
  secret: z.string(),
  otpauthUrl: z.string(),
  /** The otpauth link as a QR code image (data URL). */
  qrCode: z.string(),
});

export const enableTwoFactorRequestSchema = z.object({ code: oneTimeCodeSchema });
export const recoveryCodesResponseSchema = z.object({ recoveryCodes: z.array(z.string()) });

export const disableTwoFactorRequestSchema = z.object({
  /** Required for accounts that have a password. */
  password: z.string().max(128).optional(),
  code: oneTimeCodeSchema,
});

/** Which sign-in methods this deployment offers, for the login page. */
export const signInOptionsSchema = z.object({
  google: z.boolean(),
  github: z.boolean(),
  phone: z.boolean(),
});

export const identityProviderSchema = z.enum(["google", "github"]);

/** A Google or GitHub account linked for signing in. */
export const identitySchema = z.object({
  provider: identityProviderSchema,
  email: z.string(),
  createdAt: z.iso.datetime(),
});
export const identityListResponseSchema = z.object({ identities: z.array(identitySchema) });
export const identityParamsSchema = z.object({ provider: identityProviderSchema });

/** Where to go after a Google or GitHub sign-in finishes. */
export const oauthStartQuerySchema = z.object({
  next: z
    .string()
    .max(500)
    .regex(/^\/(?![/\\])/, "Must be a path in this app")
    .optional(),
});

/** The one-time ticket the web app exchanges for a session after Google or GitHub. */
export const oauthExchangeRequestSchema = z.object({ ticket: z.string().min(20).max(200) });
export const oauthLinkResponseSchema = z.object({ url: z.url() });

/** Sign-in and number confirmation both start by texting a code. */
export const phoneCodeRequestSchema = z.object({ phone: phoneSchema });
export const phoneCodeSentResponseSchema = z.object({
  status: z.literal("code_sent"),
  challengeId: z.uuid(),
});
export const phoneVerifyRequestSchema = z.object({
  challengeId: z.uuid(),
  code: oneTimeCodeSchema,
});

export type SignInOptions = z.infer<typeof signInOptionsSchema>;
export type IdentityProvider = z.infer<typeof identityProviderSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type PhoneCodeSentResponse = z.infer<typeof phoneCodeSentResponseSchema>;
export type PhoneVerifyRequest = z.infer<typeof phoneVerifyRequestSchema>;

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type TwoFactorRequired = z.infer<typeof twoFactorRequiredSchema>;
export type TwoFactorLoginRequest = z.input<typeof twoFactorLoginRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponseSchema>;
export type DisableTwoFactorRequest = z.infer<typeof disableTwoFactorRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const loginResponseSchema = z.union([authResponseSchema, twoFactorRequiredSchema]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;
