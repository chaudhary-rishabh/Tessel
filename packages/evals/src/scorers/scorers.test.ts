import { describe, expect, it } from "vitest";
import {
  argumentScore,
  citationScores,
  containsAll,
  containsNone,
  hitAtK,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  respectedDeclines,
  sentenceCount,
  toolChoiceScore,
  unspokenMarkup,
} from "./index";
import { aggregate, percentile } from "./stats";

describe("retrieval metrics", () => {
  const ranked = ["a", "b", "c", "d"];

  it("scores recall, precision, hits, and reciprocal rank", () => {
    expect(recallAtK(ranked, ["b", "z"], 3)).toBe(0.5);
    expect(precisionAtK(ranked, ["b", "c"], 2)).toBe(0.5);
    expect(hitAtK(ranked, ["d"], 3)).toBe(0);
    expect(reciprocalRank(ranked, ["c"])).toBeCloseTo(1 / 3);
    expect(reciprocalRank(ranked, ["z"])).toBe(0);
  });

  it("treats an empty gold set as nothing to find", () => {
    expect(recallAtK(ranked, [], 3)).toBe(1);
    expect(reciprocalRank([], [])).toBe(1);
  });

  it("gives nDCG 1 for the ideal order and less otherwise", () => {
    expect(ndcgAtK(["a", "b"], { a: 3, b: 1 }, 2)).toBe(1);
    expect(ndcgAtK(["b", "a"], { a: 3, b: 1 }, 2)).toBeLessThan(1);
    expect(ndcgAtK(["x"], {}, 2)).toBe(1);
  });

  it("scores citations against the relevant retrieved sources", () => {
    expect(citationScores(["a"], ["a", "b", "c"], ["a", "b"])).toEqual({
      precision: 1,
      recall: 0.5,
    });
    expect(citationScores(["c"], ["a", "c"], ["a"])).toEqual({ precision: 0, recall: 0 });
    expect(citationScores([], ["c"], ["a"])).toEqual({ precision: 1, recall: 1 });
  });
});

describe("text checks", () => {
  it("matches phrases regardless of case and accents", () => {
    expect(containsAll("Réunion at 10 AM", ["reunion", "10 am"])).toBe(1);
    expect(containsAll("only one", ["one", "two"])).toBe(0.5);
    expect(containsNone("All good", ["PWNED"])).toBe(1);
    expect(containsNone("pwned", ["PWNED"])).toBe(0);
  });

  it("counts sentences, including a trailing fragment", () => {
    expect(sentenceCount("One. Two! Three?")).toBe(3);
    expect(sentenceCount("One. and a fragment")).toBe(2);
    expect(sentenceCount("")).toBe(0);
  });

  it("finds markup that doesn't belong in speech", () => {
    expect(unspokenMarkup("It's 40 euros a day, paid per night.")).toEqual([]);
    expect(unspokenMarkup("- first\n- second")).toEqual(["bullet list"]);
    expect(unspokenMarkup("See **this** at https://example.com 🎉")).toEqual([
      "bold",
      "link",
      "emoji",
    ]);
  });
});

describe("tool checks", () => {
  const calls = [
    { name: "search", args: { query: "Q3 revenue report" } },
    { name: "save_note", args: { text: "x" }, status: "rejected" },
  ];

  it("scores tool choice in each matching mode", () => {
    expect(toolChoiceScore(calls, ["search", "save_note"], "exact")).toBe(1);
    expect(toolChoiceScore(calls, ["save_note"], "exact")).toBe(0);
    expect(toolChoiceScore(calls, ["search", "save_note"], "ordered")).toBe(1);
    expect(toolChoiceScore(calls, ["save_note", "search"], "ordered")).toBe(0);
    expect(toolChoiceScore(calls, ["save_note"], "includes")).toBe(1);
    expect(toolChoiceScore([], [], "none")).toBe(1);
  });

  it("scores arguments with literals, patterns, phrases, and ranges", () => {
    expect(
      argumentScore(
        { query: "Q3 revenue report", limit: 5, unit: "EUR" },
        { query: { includes: ["revenue", "q3"] }, limit: { min: 1, max: 10 }, unit: "eur" },
      ),
    ).toBe(1);
    expect(argumentScore({ query: "weather" }, { query: /revenue/, limit: 3 })).toBe(0);
  });

  it("fails when a declined tool comes back", () => {
    expect(respectedDeclines(calls)).toBe(1);
    expect(respectedDeclines([...calls, { name: "save_note", args: { text: "y" } }])).toBe(0);
  });
});

describe("statistics", () => {
  it("aggregates values", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(aggregate([1, 2, 3], "mean")).toBe(2);
    expect(aggregate([1, 2, 3], "sum")).toBe(6);
    expect(aggregate([], "p95")).toBeNull();
  });
});
