import { defineConfig } from "tsdown";

// Bundles the migration runner (and the grant-admin tool) for the production `migrate` image. The bundle
// lives in dist/, so `../migrations` still resolves to this package's folder.
export default defineConfig({
  entry: { migrate: "src/scripts/migrate.ts", "grant-admin": "src/scripts/grant-admin.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
});
