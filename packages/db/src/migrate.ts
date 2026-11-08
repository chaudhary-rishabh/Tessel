import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
export const APP_ROLE = "tessel_app";

export interface RunMigrationsOptions {
  /** Owner connection used to apply migrations. */
  migrationUrl: string;
  /**
   * The API's connection string. When given, its user is set up to log in
   * with its password and is granted the restricted app role.
   */
  appUrl?: string;
}

/** Applies pending migrations, then makes sure the API's database user can log in. */
export async function runMigrations({ migrationUrl, appUrl }: RunMigrationsOptions): Promise<void> {
  const client = new pg.Client({ connectionString: migrationUrl });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    if (appUrl) {
      await ensureAppLogin(client, appUrl);
    }
  } finally {
    await client.end();
  }
}

async function ensureAppLogin(client: pg.Client, appUrl: string): Promise<void> {
  const { username, password } = new URL(appUrl);
  const user = decodeURIComponent(username);
  if (!user) {
    throw new Error("DATABASE_URL must include a username.");
  }

  const role = client.escapeIdentifier(user);
  const passwordClause = password
    ? ` PASSWORD ${client.escapeLiteral(decodeURIComponent(password))}`
    : "";
  const exists = await client.query("select 1 from pg_roles where rolname = $1", [user]);

  if (exists.rowCount === 0) {
    await client.query(`create role ${role} login nosuperuser nobypassrls${passwordClause}`);
  } else {
    await client.query(`alter role ${role} login${passwordClause}`);
  }

  if (user !== APP_ROLE) {
    await client.query(`grant ${client.escapeIdentifier(APP_ROLE)} to ${role}`);
  }
}
