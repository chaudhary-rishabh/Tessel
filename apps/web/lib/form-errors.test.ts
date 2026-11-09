import { describe, expect, it } from "vitest";
import { safeNextPath } from "./form-errors";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/chat?thread=1")).toBe("/chat?thread=1");
    expect(safeNextPath("/invite/abc#join")).toBe("/invite/abc#join");
  });

  it("rejects anything that could leave the app", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      // Browsers drop tabs and newlines, so these become //evil.example.
      "/\t/evil.example",
      "/\n/evil.example",
      "/\\\\evil.example",
      "/.//evil.example",
      "settings",
      "",
    ]) {
      expect(safeNextPath(next)).toBe("/chat");
    }
    expect(safeNextPath(null)).toBe("/chat");
  });
});
