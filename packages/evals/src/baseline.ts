import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvalMode, SuiteResult } from "./types";

/**
 * A suite's accepted metric values per mode, kept next to the suite. A run
 * that does worse than its baseline (beyond each metric's tolerance) fails
 * as a regression even when it still clears the gate.
 */
export interface Baseline {
  suite: string;
  mode: EvalMode;
  updatedAt: string;
  metrics: Record<string, number>;
}

export const baselinePath = (suiteDir: string, suite: string, mode: EvalMode) =>
  join(suiteDir, "baselines", `${suite}.${mode}.json`);

export async function readBaseline(path: string): Promise<Baseline | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Baseline;
  } catch {
    return undefined;
  }
}

export async function writeBaseline(path: string, result: SuiteResult): Promise<void> {
  const metrics = Object.fromEntries(
    result.metrics
      // Timings depend on the machine, so they're held to explicit budgets (gates), not baselines.
      .filter((metric) => metric.value !== null && metric.unit !== "ms")
      .map((metric) => [metric.name, Number((metric.value as number).toFixed(4))]),
  );
  const baseline: Baseline = {
    suite: result.suite,
    mode: result.mode,
    updatedAt: result.startedAt,
    metrics,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
}
