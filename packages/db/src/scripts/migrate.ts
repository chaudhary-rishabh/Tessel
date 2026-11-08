import { resolve } from "node:path";
import { config } from "dotenv";
import { runMigrations } from "../migrate";

// Locally, read .env from this package or the repo root. In containers the
// variables come from the environment and no file exists.
config({
  path: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")],
  quiet: true,
});

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) {
  throw new Error("DATABASE_MIGRATION_URL is not set. Copy .env.example to .env at the repo root.");
}

await runMigrations({ migrationUrl, appUrl: process.env.DATABASE_URL });
process.stdout.write("Migrations applied.\n");
