import { z } from "zod";
import { emailSchema, passwordSchema, personNameSchema, publicUserSchema } from "./users";

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: personNameSchema,
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

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
