import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output keeps the production Docker image small (step 4).
  output: "standalone",
  // Trace files from the monorepo root so workspace packages are included.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@tessel/contracts"],
};

export default nextConfig;
