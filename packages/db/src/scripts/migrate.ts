import { loadEnvFiles } from "@tessel/config/env";
import { runMigrations } from "../migrate";

loadEnvFiles();

const migrationUrl = process.env.DATABASE_MIGRATION_URL;
if (!migrationUrl) {
  throw new Error("DATABASE_MIGRATION_URL is not set. Copy .env.example to .env at the repo root.");
}

await runMigrations({ migrationUrl, appUrl: process.env.DATABASE_URL });
process.stdout.write("Migrations applied.\n");
