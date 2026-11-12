import { setUserContext, type Database, type UserRow } from "@tessel/db";
import { sql } from "drizzle-orm";
import { usersRepository, type NewUser } from "../users/users.repository";
import { workspacesRepository } from "../workspaces/workspaces.repository";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Creates a user and their personal workspace, inside the caller's
 * transaction. Every way of signing up ends here.
 */
export async function createAccount(tx: Transaction, input: NewUser): Promise<UserRow> {
  const created = await usersRepository.insert(tx, input);
  // Act as the new user so row-level security allows creating their workspace.
  await setUserContext(tx, created.id);
  await workspacesRepository.createWithOwner(tx, {
    name: `${input.name.split(/\s+/)[0]}'s workspace`,
    ownerId: created.id,
    isPersonal: true,
  });
  return created;
}

/**
 * A starting name for someone who signed up with just an email, from the part
 * before the @: "ada.lovelace+work@example.com" becomes "Ada Lovelace". They
 * can change it in Settings.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0]?.split("+")[0] ?? "";
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ").slice(0, 100) || "Tessel user";
}

/**
 * When someone proves they own an email that isn't confirmed yet, removes
 * every way into its account set up before then (password, two-step sign-in,
 * phone, linked sign-ins, sessions, tokens, connected apps), since whoever
 * signed up may not own the address. Does nothing to confirmed accounts.
 */
export async function resetUnverifiedAccount(tx: Transaction, userId: string): Promise<boolean> {
  const rows = await tx.execute<{ reset: boolean }>(
    sql`SELECT app.reset_unverified_account(${userId}::uuid) AS reset`,
  );
  return rows.rows[0]?.reset ?? false;
}
