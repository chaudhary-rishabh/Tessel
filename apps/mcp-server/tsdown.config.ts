import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/server.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled in.
  // Third-party packages stay external: each app lists every runtime
  // dependency it needs (including those of workspace packages).
  deps: { alwaysBundle: [/^@tessel\//] },
});
