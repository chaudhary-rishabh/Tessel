import type { MockGateway } from "@tessel/ai/testing";
import type { Judge } from "./judge";
import type { UsageMeter } from "./usage";

/**
 * Shared shapes for evaluation suites.
 *
 * A suite is a list of cases, a function that runs one case against the real
 * code, and a scorer that turns the output into metric values. The runner
 * aggregates the values per metric and checks them against gates.
 */

/**
 * Where model calls go.
 * - mock: the local mock gateway. Free and deterministic; checks the code
 *   around the models (retrieval, filtering, approvals, turn-taking), not the
 *   models themselves.
 * - replay: recorded live responses (cassettes). Free and deterministic, and
 *   measures real model behaviour as it was when recorded.
 * - live: the real AI gateway. Costs money; the source of truth.
 */
export type EvalMode = "mock" | "replay" | "live";

export const EVAL_MODES: readonly EvalMode[] = ["mock", "replay", "live"];

/** How a metric's per-case values become one number. */
export type Aggregate = "mean" | "min" | "max" | "p50" | "p95" | "sum";

export interface MetricSpec {
  name: string;
  /** One line for the report: what a good value means. */
  description: string;
  /** Whether bigger is better. */
  direction: "higher" | "lower";
  /** How values combine across cases. Defaults to the mean. */
  aggregate?: Aggregate;
  /** How the value is shown in reports. */
  unit?: "ratio" | "ms" | "count" | "score";
  /**
   * The value the aggregate must reach (higher) or stay under (lower) for the
   * run to pass, per mode. A mode without a gate only reports the metric.
   */
  gate?: Partial<Record<EvalMode, number>>;
  /**
   * How far below (or above, for lower-is-better) the saved baseline the
   * aggregate may move before it counts as a regression. Defaults to 0.02 for
   * ratios and scores, 15% of the baseline for milliseconds and counts.
   */
  tolerance?: number;
}

/** One metric's value for one case. `null` means the metric didn't apply (skipped). */
export interface Score {
  metric: string;
  value: number | null;
  /** Why the case scored what it did, for the report. */
  detail?: string;
}

export interface EvalCase<Input> {
  /** Stable and unique within the suite; baselines and cassettes key on it. */
  id: string;
  input: Input;
  /** Free-form labels for filtering and per-tag breakdowns. */
  tags?: string[];
  /** Run this case only in these modes (e.g. cases that need a real model). */
  modes?: EvalMode[];
}

/** What a suite gets to set itself up with. */
export interface EvalContext {
  mode: EvalMode;
  /** OpenAI-compatible gateway URL (mock, cassette proxy, or the real gateway). */
  gatewayUrl: string;
  gatewayKey: string;
  /** Grades free-form answers against a rubric; absent in mock mode. */
  judge?: Judge;
  /** Usage recorded by every model call the suite makes through `ai`. */
  usage: UsageMeter;
  /** The mock gateway, in mock mode, for scripting replies. */
  mock?: MockGateway;
  /** A fixed clock, so prompts (which carry the date) match their recordings. */
  now: Date;
}

export interface Suite<Input, Output, Setup = unknown> {
  /** kebab-case; names the report, baseline, and cassette folder. */
  name: string;
  description: string;
  /** Modes the suite can run in. */
  modes: EvalMode[];
  metrics: MetricSpec[];
  cases: EvalCase<Input>[];
  /** Times each case runs; more trials measure consistency. Per mode. */
  trials?: Partial<Record<EvalMode, number>>;
  /** How long one case may take before it fails. Defaults to 60 seconds. */
  timeoutMs?: number;
  /** Cases run at once. Defaults to 4. */
  concurrency?: number;
  setup(context: EvalContext): Promise<Setup>;
  teardown?(setup: Setup): Promise<void>;
  run(setup: Setup, testCase: EvalCase<Input>, trial: number): Promise<Output>;
  score(
    setup: Setup,
    testCase: EvalCase<Input>,
    output: Output,
    context: EvalContext,
  ): Promise<Score[]> | Score[];
  /** A short, readable version of the output for the report. */
  describe?(output: Output): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySuite = Suite<any, any, any>;

export interface CaseResult {
  id: string;
  trial: number;
  tags: string[];
  durationMs: number;
  scores: Score[];
  error?: string;
  output?: string;
}

export interface MetricResult {
  name: string;
  description: string;
  direction: "higher" | "lower";
  unit: NonNullable<MetricSpec["unit"]>;
  aggregate: Aggregate;
  /** null when no case produced a value. */
  value: number | null;
  /** Cases (times trials) that produced a value. */
  samples: number;
  gate?: number;
  /** For metrics scored 0 or 1 over several trials: share of cases that passed every trial. */
  passAllTrials?: number;
  baseline?: number;
  /** "gate" when below the gate, "regression" when worse than the baseline allows. */
  failure?: "gate" | "regression";
}

export interface SuiteResult {
  suite: string;
  description: string;
  mode: EvalMode;
  startedAt: string;
  durationMs: number;
  trials: number;
  metrics: MetricResult[];
  cases: CaseResult[];
  errors: number;
  usage: { calls: number; inputTokens: number; outputTokens: number; usd: number };
  passed: boolean;
  /** Set when the suite doesn't support the mode, or couldn't start. */
  skipped?: string;
}
