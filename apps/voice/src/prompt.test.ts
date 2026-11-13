import { describe, expect, it } from "vitest";
import { voiceInstructions } from "./prompt";

describe("voice instructions", () => {
  it("asks for short spoken replies with no formatting, and names the user", () => {
    const text = voiceInstructions({ userName: "Ada", now: new Date("2026-11-14T10:00:00Z") });
    expect(text).toContain("Their name is Ada.");
    expect(text).toMatch(/Today is Saturday,? 14 November 2026\./);
    expect(text).toMatch(/Never use markdown/);
    expect(text).toMatch(/one to three sentences/);
  });

  it("leaves the name out when there isn't one", () => {
    expect(voiceInstructions({ userName: "" })).not.toContain("Their name is");
  });
});
