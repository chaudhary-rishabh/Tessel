import type { PublicUser } from "@tessel/contracts";
import type { UserRow } from "@tessel/db";

/** The only user shape that leaves the API. Never includes the password hash. */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerifiedAt !== null,
    twoFactorEnabled: row.totpEnabledAt !== null,
    hasPassword: row.passwordHash !== null,
  };
}
