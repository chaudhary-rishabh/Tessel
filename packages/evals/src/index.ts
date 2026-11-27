export * from "./baseline";
export * from "./cassette";
export * from "./context";
export * from "./judge";
export * from "./report";
export * from "./runner";
export * from "./scorers/index";
export * from "./types";
export * from "./usage";

import type { Suite } from "./types";

/** Declares a suite with its types inferred from `setup`, `run`, and the cases. */
export function defineSuite<Input, Output, Setup>(
  suite: Suite<Input, Output, Setup>,
): Suite<Input, Output, Setup> {
  const ids = new Set<string>();
  for (const testCase of suite.cases) {
    if (ids.has(testCase.id))
      throw new Error(`Suite "${suite.name}" has two cases named "${testCase.id}"`);
    ids.add(testCase.id);
  }
  const metrics = new Set(suite.metrics.map((metric) => metric.name));
  if (metrics.size !== suite.metrics.length)
    throw new Error(`Suite "${suite.name}" repeats a metric`);
  return suite;
}
