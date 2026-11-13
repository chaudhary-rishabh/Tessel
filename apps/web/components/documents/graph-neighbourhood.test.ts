import type { GraphFactView } from "@tessel/contracts";
import { describe, expect, it } from "vitest";
import { neighbourhood } from "./graph-neighbourhood";

const fact = (source: string, type: string, target: string): GraphFactView => ({
  source,
  sourceType: "Person",
  type,
  target,
  targetType: "Team",
  description: "",
  documentId: "d",
  filename: "f.md",
  chunkIndex: 0,
});

describe("neighbourhood", () => {
  it("collects each neighbour once, with its relations in both directions", () => {
    expect(
      neighbourhood("alice chen", [
        fact("Alice Chen", "MANAGES", "Payments Team"),
        fact("Alice Chen", "MANAGES", "Payments Team"),
        fact("Bob", "REPORTS_TO", "Alice Chen"),
        fact("Carol", "WORKS_ON", "Ledger"),
      ]),
    ).toEqual([
      { name: "Payments Team", type: "Team", links: [{ type: "MANAGES", outgoing: true }] },
      { name: "Bob", type: "Person", links: [{ type: "REPORTS_TO", outgoing: false }] },
    ]);
  });
});
