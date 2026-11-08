import { runMigrations } from "@tessel/db/migrate";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Restricted app role, so row-level security applies like in production. */
    testDatabaseUrl: string;
    /** Database owner, for test setup that must bypass row-level security. */
    testDatabaseOwnerUrl: string;
  }
}

const DEFAULT_ADMIN_URL = "postgres://tessel:tessel@localhost:5432/postgres";
// A separate login role keeps tests from changing the local `tessel_app` password.
const TEST_APP_USER = "tessel_app_test";
const TEST_APP_PASSWORD = "tessel_app_test";

function withDatabase(url: string, database: string, user?: { name: string; password: string }) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) {
    parsed.username = user.name;
    parsed.password = user.password;
  }
  return parsed.toString();
}

/**
 * Creates a throwaway database for this test run, applies every migration,
 * and drops it afterwards.
 */
export default async function setup(project: TestProject) {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const database = `tessel_test_${Date.now().toString(36)}_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });

  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `API tests need Postgres at ${new URL(adminUrl).host}. ` +
        "Start it with `pnpm infra:up`, or set TEST_DATABASE_ADMIN_URL.",
      { cause: error },
    );
  }

  await admin.query(`create database ${admin.escapeIdentifier(database)}`);
  const ownerUrl = withDatabase(adminUrl, database);
  const appUrl = withDatabase(adminUrl, database, {
    name: TEST_APP_USER,
    password: TEST_APP_PASSWORD,
  });
  await runMigrations({ migrationUrl: ownerUrl, appUrl });

  project.provide("testDatabaseUrl", appUrl);
  project.provide("testDatabaseOwnerUrl", ownerUrl);

  return async () => {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [database],
    );
    await admin.query(`drop database if exists ${admin.escapeIdentifier(database)}`);
    await admin.end();
  };
}
