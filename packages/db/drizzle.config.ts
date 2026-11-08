import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ["../../.env"], quiet: true });

// Migrations run as the database owner. The API connects as the restricted
// `tessel_app` role (DATABASE_URL) so row-level security applies to it.
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is not set. Copy .env.example to .env at the repo root.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
