import { userIdentities, type Database, type UserRow } from "@tessel/db";
import { count, eq } from "drizzle-orm";
import { errors } from "../../lib/errors";

/** Password, linked Google or GitHub accounts, and a verified phone. */
export async function signInMethodCount(db: Database, user: UserRow): Promise<number> {
  const [row] = await db
    .select({ identities: count() })
    .from(userIdentities)
    .where(eq(userIdentities.userId, user.id));
  return (user.passwordHash ? 1 : 0) + (user.phoneVerifiedAt ? 1 : 0) + (row?.identities ?? 0);
}

/** Refuses to remove the only way left to sign in. */
export async function assertNotLastSignInMethod(db: Database, user: UserRow): Promise<void> {
  if ((await signInMethodCount(db, user)) <= 1) {
    throw errors.conflict(
      "last_sign_in_method",
      "This is the only way you can sign in. Add another first, such as a password.",
    );
  }
}
