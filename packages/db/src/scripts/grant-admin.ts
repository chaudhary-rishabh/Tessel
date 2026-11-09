import { resolve } from "node:path";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDatabase } from "../client";
import { users } from "../schema/users";

/**
 * Makes an existing account a platform admin (or takes it away with --revoke).
 * Admins can only be made here or by another admin, never through sign-up.
 *
 *   pnpm --filter @tessel/db grant-admin you@example.com
 *   docker compose --profile tools run --rm migrate node dist/grant-admin.mjs you@example.com
 */
config({
  path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const email = args
  .find((arg) => !arg.startsWith("--"))
  ?.trim()
  .toLowerCase();
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!email || !url) {
  process.stderr.write("Usage: grant-admin <email> [--revoke] (needs DATABASE_MIGRATION_URL)\n");
  process.exit(1);
}

const { db, pool } = createDatabase({ url, maxConnections: 1 });
const [user] = await db
  .update(users)
  .set({ role: revoke ? "user" : "admin" })
  .where(eq(users.email, email))
  .returning({ id: users.id });
await pool.end();
if (!user) {
  process.stderr.write(`No account uses ${email}. Sign up first, then run this again.\n`);
  process.exit(1);
}
process.stdout.write(`${email} is ${revoke ? "no longer an admin" : "now an admin"}.\n`);
