import { describe, expect, it } from "vitest";
import { isSystemJobName, jobSchemas } from "./jobs";

describe("system job schemas", () => {
  it("accepts a valid ping payload", () => {
    const result = jobSchemas.system.ping.safeParse({
      requestedAt: "2026-11-08T10:00:00.000Z",
      source: "api",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload without a timestamp", () => {
    const result = jobSchemas.system.ping.safeParse({ source: "api" });
    expect(result.success).toBe(false);
  });

  it("recognises known job names only", () => {
    expect(isSystemJobName("ping")).toBe(true);
    expect(isSystemJobName("toString")).toBe(false);
  });
});
