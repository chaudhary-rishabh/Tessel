import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output keeps the production Docker image small.
  // Off by default so `next start` works for local runs and end-to-end tests.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@tessel/contracts", "@tessel/ui", "@tessel/api-client"],
};

export default nextConfig;
