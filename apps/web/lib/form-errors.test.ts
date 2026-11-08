import { describe, expect, it } from "vitest";
import { safeNextPath } from "./form-errors";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/chat?thread=1")).toBe("/chat?thread=1");
  });

  it("rejects anything that could leave the app", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "settings",
      "",
    ]) {
      expect(safeNextPath(next)).toBe("/chat");
    }
    expect(safeNextPath(null)).toBe("/chat");
  });
});
