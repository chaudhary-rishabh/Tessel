import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const WEB_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000";

/**
 * End-to-end tests run the real web app against the real API, on a desktop
 * and a phone viewport. Postgres and Redis must be running (pnpm infra:up)
 * and migrated (pnpm db:migrate).
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
      command: "pnpm exec tsx src/server.ts",
      cwd: "../api",
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      // Each test signs up fresh users; lift limits for the test run only.
      env: { RATE_LIMIT_SCALE: "100" },
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
