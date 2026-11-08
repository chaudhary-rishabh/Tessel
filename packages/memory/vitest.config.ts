import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "memory",
    environment: "node",
  },
});
