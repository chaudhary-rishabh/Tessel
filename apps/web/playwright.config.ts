import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";
const MOCK_GATEWAY_URL = "http://127.0.0.1:4300/v1";

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
      command: "pnpm exec tsx src/server.ts",
      cwd: "../api",
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      // Each test signs up fresh users; lift limits for the test run only.
      env: {
        RATE_LIMIT_SCALE: "100",
        AI_GATEWAY_API_KEY: "mock",
        AI_GATEWAY_URL: MOCK_GATEWAY_URL,
      },
      timeout: 60_000,
    },
    {
      command: isCI ? "pnpm start" : "pnpm dev",
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
