import { describe, expect, it } from "vitest";
import { suggestMode } from "./mode-suggestion";

describe("suggestMode", () => {
  it("leaves short and simple messages alone", () => {
    expect(suggestMode("What's our travel policy?")).toBeNull();
    expect(
      suggestMode("Can you explain how the refund process works for annual customers, briefly?"),
    ).toBeNull();
  });

  it("suggests Plan for a list of steps or a sequence", () => {
    expect(
      suggestMode(
        "Help me prepare the launch:\n1. List the open issues\n2. Group them by owner\n3. Draft a status note",
      ),
    ).toBe("plan");
    expect(
      suggestMode(
        "First collect last quarter's numbers, then compare them with the target, and finally tell me where we fell short.",
      ),
    ).toBe("plan");
  });

  it("suggests Team when the work mixes research, numbers, and writing", () => {
    expect(
      suggestMode(
        "Research what our three biggest competitors charge, calculate how much we'd lose if we matched the cheapest, and draft an email to the pricing team with a recommendation.",
      ),
    ).toBe("team");
  });
});
