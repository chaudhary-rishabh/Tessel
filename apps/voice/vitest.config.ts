import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "voice",
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // A conversation runs in real time: audio is spoken and played back at speed.
    testTimeout: 30_000,
  },
});
