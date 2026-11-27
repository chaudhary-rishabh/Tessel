import { describe, expect, it } from "vitest";
import { defineSuite } from "./index";
import { judgeMetric, runSuite } from "./runner";
import type { EvalContext, MetricSpec } from "./types";
import { createUsageMeter } from "./usage";

const context = (mode: EvalContext["mode"] = "mock"): EvalContext => ({
  mode,
  gatewayUrl: "http://unused",
  gatewayKey: "unused",
  usage: createUsageMeter(),
  now: new Date("2026-06-15T09:00:00Z"),
});

const accuracy: MetricSpec = {
  name: "accuracy",
  description: "Right answers",
  direction: "higher",
  gate: { mock: 0.5 },
};

function arithmetic(answers: Record<string, number | Error | "hang">) {
  return defineSuite<{ a: number; b: number }, number, { calls: number }>({
    name: "arithmetic",
    description: "Adds numbers.",
    modes: ["mock"],
    metrics: [
      accuracy,
      { name: "latency", description: "Time", direction: "lower", unit: "ms", aggregate: "p95" },
    ],
    timeoutMs: 50,
    cases: [
      { id: "one", input: { a: 1, b: 1 }, tags: ["easy"] },
      { id: "two", input: { a: 2, b: 3 } },
    ],
    setup: async () => ({ calls: 0 }),
    run: async (setup, testCase) => {
      setup.calls += 1;
      const answer = answers[testCase.id]!;
      if (answer === "hang") return new Promise<number>(() => undefined);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    score: (_, testCase, output) => [
      { metric: "accuracy", value: output === testCase.input.a + testCase.input.b ? 1 : 0 },
      { metric: "latency", value: 10 },
    ],
  });
}

describe("runSuite", () => {
  it("aggregates scores and passes when every gate holds", async () => {
    const result = await runSuite(arithmetic({ one: 2, two: 4 }), context());
    expect(result.passed).toBe(true);
    expect(result.metrics[0]).toMatchObject({
      name: "accuracy",
      value: 0.5,
      samples: 2,
      gate: 0.5,
    });
    expect(result.metrics[1]).toMatchObject({ name: "latency", value: 10, unit: "ms" });
  });

  it("fails below a gate, and on a regression from the baseline", async () => {
    const failing = await runSuite(arithmetic({ one: 0, two: 0 }), context());
    expect(failing.passed).toBe(false);
    expect(failing.metrics[0]?.failure).toBe("gate");

    const regressed = await runSuite(arithmetic({ one: 2, two: 4 }), context(), {
      baseline: { accuracy: 1 },
    });
    expect(regressed.passed).toBe(false);
    expect(regressed.metrics[0]?.failure).toBe("regression");
  });

  it("records errors and timeouts as failed cases", async () => {
    const result = await runSuite(arithmetic({ one: new Error("boom"), two: "hang" }), context());
    expect(result.passed).toBe(false);
    expect(result.errors).toBe(2);
    expect(result.cases.map((item) => item.error)).toEqual(["boom", "Timed out after 50 ms"]);
  });

  it("runs trials and reports how many cases passed every one", async () => {
    let call = 0;
    const flaky = defineSuite<null, number, null>({
      name: "flaky",
      description: "Sometimes right.",
      modes: ["mock"],
      metrics: [{ ...accuracy, gate: {} }],
      cases: [
        { id: "steady", input: null },
        { id: "wobbly", input: null },
      ],
      setup: async () => null,
      run: async (_, testCase) => (testCase.id === "steady" ? 1 : call++ % 2),
      score: (_, __, output) => [{ metric: "accuracy", value: output }],
      concurrency: 1,
    });
    const result = await runSuite(flaky, context(), { trials: 2 });
    expect(result.trials).toBe(2);
    expect(result.cases).toHaveLength(4);
    expect(result.metrics[0]).toMatchObject({ value: 0.75, passAllTrials: 0.5 });
  });

  it("filters cases by ID or tag, and skips modes the suite doesn't support", async () => {
    const filtered = await runSuite(arithmetic({ one: 2, two: 5 }), context(), { filter: "easy" });
    expect(filtered.cases.map((item) => item.id)).toEqual(["one"]);

    const skipped = await runSuite(arithmetic({ one: 2, two: 5 }), context("live"));
    expect(skipped).toMatchObject({ passed: true, skipped: "Doesn't run in live mode" });
  });
});

describe("judgeMetric", () => {
  const latency: MetricSpec = {
    name: "p95",
    description: "",
    direction: "lower",
    unit: "ms",
    gate: { live: 800 },
  };

  it("checks lower-is-better gates and percentage tolerances for timings", () => {
    expect(judgeMetric(latency, 900, "live").failure).toBe("gate");
    expect(judgeMetric(latency, 700, "live", 600).failure).toBe("regression");
    expect(judgeMetric(latency, 680, "live", 600).failure).toBeUndefined();
  });

  it("fails a gated metric that produced no value", () => {
    expect(judgeMetric(accuracy, null, "mock").failure).toBe("gate");
    expect(judgeMetric(accuracy, null, "live").failure).toBeUndefined();
  });
});
