import { defineConfig } from "tsdown";

export default defineConfig({
  // main.mjs runs the agent server; agent.mjs is what each job process loads.
  entry: ["src/main.ts", "src/agent.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled in.
  // Third-party packages stay external: each app lists every runtime
  // dependency it needs (including those of workspace packages).
  deps: { alwaysBundle: [/^@tessel\//] },
});
