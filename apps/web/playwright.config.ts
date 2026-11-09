import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";
const ADMIN_URL = "http://localhost:3001";
const MOCK_GATEWAY_URL = "http://127.0.0.1:4300/v1";
// A GitHub-like mock MCP server that takes a token; another on 4401 signs in with OAuth.
const MOCK_GITHUB_MCP_URL = "http://127.0.0.1:4400/mcp";
// A mock Google and GitHub for "Continue with Google / GitHub".
const MOCK_OAUTH_URL = "http://127.0.0.1:4500";

/**
 * End-to-end tests run the real web app against the real API, on a desktop
 * and a phone viewport. Postgres and Redis must be running (pnpm infra:up)
 * and migrated (pnpm db:migrate), along with the S3, SQS, and Qdrant
 * emulators. Model calls go to a local mock gateway.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "pnpm mock-gateway",
      cwd: "../../packages/ai",
      url: `${MOCK_GATEWAY_URL}/health`,
      reuseExistingServer: !isCI,
      timeout: 30_000,
    },
    {
      command: "pnpm mock-server",
      cwd: "../../packages/mcp",
      url: "http://127.0.0.1:4400/health",
      reuseExistingServer: !isCI,
      env: { MOCK_MCP_PORT: "4400", MOCK_MCP_AUTH: "token" },
      timeout: 30_000,
    },
    {
      command: "pnpm mock-server",
      cwd: "../../packages/mcp",
      url: "http://127.0.0.1:4401/health",
      reuseExistingServer: !isCI,
      env: { MOCK_MCP_PORT: "4401", MOCK_MCP_AUTH: "oauth" },
      timeout: 30_000,
    },
    {
      command: "pnpm mock-oauth",
      cwd: "../api",
      url: `${MOCK_OAUTH_URL}/health`,
      reuseExistingServer: !isCI,
      env: { MOCK_OAUTH_PORT: "4500" },
      timeout: 30_000,
    },
    {
      command: "pnpm exec tsx src/server.ts",
      cwd: "../api",
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      // Each test signs up fresh users; lift limits for the test run only.
      env: {
        RATE_LIMIT_SCALE: "100",
        AI_GATEWAY_API_KEY: "mock",
        AI_GATEWAY_URL: MOCK_GATEWAY_URL,
        GITHUB_MCP_URL: MOCK_GITHUB_MCP_URL,
        GOOGLE_CLIENT_ID: "e2e-google",
        GOOGLE_CLIENT_SECRET: "e2e-google-secret",
        GITHUB_CLIENT_ID: "e2e-github",
        GITHUB_CLIENT_SECRET: "e2e-github-secret",
        SOCIAL_LOGIN_MOCK_URL: MOCK_OAUTH_URL,
        SMS_TRANSPORT: "outbox",
      },
      timeout: 60_000,
    },
    {
      // Tessel's own MCP server, for outside clients with personal access tokens.
      command: "pnpm exec tsx src/server.ts",
      cwd: "../mcp-server",
      url: "http://localhost:4100/health",
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      // Indexes uploaded documents: SQS upload events, then parse, embed, and store in Qdrant.
      command: "pnpm exec tsx src/worker.ts",
      cwd: "../worker",
      url: "http://localhost:4200/health",
      reuseExistingServer: !isCI,
      // Worker logs go to the CI log, since ingestion failures only show there.
      stdout: isCI ? "pipe" : "ignore",
      env: { AI_GATEWAY_API_KEY: "mock", AI_GATEWAY_URL: MOCK_GATEWAY_URL },
      timeout: 60_000,
    },
    {
      command: isCI ? "pnpm start" : "pnpm dev",
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // The admin app, for the admin end-to-end tests.
      command: isCI ? "pnpm start" : "pnpm dev",
      cwd: "../admin",
      url: `${ADMIN_URL}/login`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
