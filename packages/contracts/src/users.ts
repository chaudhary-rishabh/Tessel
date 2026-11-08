import { z } from "zod";

/** Trimmed and lowercased before validation, so emails compare case-insensitively. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address" }).max(254));

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters");

export const personNameSchema = z.string().trim().min(1, "Name is required").max(100);

export const userRoleSchema = z.enum(["user", "admin"]);

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: userRoleSchema,
  createdAt: z.iso.datetime(),
  emailVerified: z.boolean(),
  /** Whether sign-in asks for an authenticator code. */
  twoFactorEnabled: z.boolean(),
  /** False for accounts that only sign in with Google, GitHub, or a phone. */
  hasPassword: z.boolean(),
  /** A verified mobile number for signing in with a text code. */
  phone: z.string().nullable(),
});

/**
 * A mobile number in international (E.164) form. Spaces, dashes, dots, and
 * brackets are dropped, so "+91 98765-43210" becomes "+919876543210".
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .pipe(
    z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, "Enter the number with its country code, like +91 98765 43210"),
  );

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(128),
  newPassword: passwordSchema,
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
