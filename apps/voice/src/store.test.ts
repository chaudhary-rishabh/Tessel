import { describe, expect, it } from "vitest";
import { titleFrom } from "./store";

describe("a voice chat's first title", () => {
  it("uses what the user first said", () => {
    expect(titleFrom("  What's a good   name for a  cat? ")).toBe("What's a good name for a cat?");
  });

  it("cuts long speech at a word, without trailing punctuation", () => {
    const title = titleFrom(
      "I need help planning a three week trip across Japan, starting in Tokyo, then Kyoto and Osaka",
    );
    expect(title.length).toBeLessThanOrEqual(61);
    expect(title).toBe("I need help planning a three week trip across Japan…");
  });
});
