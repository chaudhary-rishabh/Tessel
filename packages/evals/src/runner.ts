import { aggregate } from "./scorers/stats";
import type {
  AnySuite,
  CaseResult,
  EvalCase,
  EvalContext,
  MetricResult,
  MetricSpec,
  SuiteResult,
} from "./types";

export interface RunOptions {
  /** Overrides the suite's trial count for this mode. */
  trials?: number;
  /** Run only cases whose ID or tags include this text. */
  filter?: string;
  /** Saved metric values to compare against, from the baseline file. */
  baseline?: Record<string, number>;
  /** Called after each case, for progress output. */
  onCase?: (result: CaseResult) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_CONCURRENCY = 4;

class CaseTimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`);
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new CaseTimeoutError(ms)), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(workers);
}

const errorText = (error: unknown) =>
  error instanceof Error
    ? `${error.name === "Error" ? "" : `${error.name}: `}${error.message}`
    : String(error);

const defaultUnit = (spec: MetricSpec) => spec.unit ?? "ratio";

/** How far from the baseline a metric may move before it's a regression. */
export function toleranceFor(spec: MetricSpec, baseline: number): number {
  if (spec.tolerance !== undefined) return spec.tolerance;
  const unit = defaultUnit(spec);
  return unit === "ms" || unit === "count" ? Math.abs(baseline) * 0.15 : 0.02;
}

export function judgeMetric(
  spec: MetricSpec,
  value: number | null,
  mode: EvalContext["mode"],
  baseline?: number,
): Pick<MetricResult, "gate" | "baseline" | "failure"> {
  const gate = spec.gate?.[mode];
  const worse = (actual: number, limit: number) =>
    spec.direction === "higher" ? actual < limit : actual > limit;
  const result: Pick<MetricResult, "gate" | "baseline" | "failure"> = {
    ...(gate === undefined ? {} : { gate }),
    ...(baseline === undefined ? {} : { baseline }),
  };
  if (value === null) return gate === undefined ? result : { ...result, failure: "gate" };
  // Tiny float noise shouldn't fail a gate set at exactly the achieved value.
  const epsilon = 1e-9;
  if (
    gate !== undefined &&
    worse(value, spec.direction === "higher" ? gate - epsilon : gate + epsilon)
  ) {
    return { ...result, failure: "gate" };
  }
  if (baseline !== undefined) {
    const tolerance = toleranceFor(spec, baseline);
    const limit = spec.direction === "higher" ? baseline - tolerance : baseline + tolerance;
    if (worse(value, limit)) return { ...result, failure: "regression" };
  }
  return result;
}

function summarize(
  specs: readonly MetricSpec[],
  cases: readonly CaseResult[],
  trials: number,
  mode: EvalContext["mode"],
  baseline: Record<string, number> | undefined,
): MetricResult[] {
  return specs.map((spec) => {
    const how = spec.aggregate ?? "mean";
    const values = cases.flatMap((result) =>
      result.scores
        .filter((score) => score.metric === spec.name && score.value !== null)
        .map((score) => score.value as number),
    );
    const value = aggregate(values, how);
    let passAllTrials: number | undefined;
    const binary = values.length > 0 && values.every((v) => v === 0 || v === 1);
    if (trials > 1 && binary) {
      const byCase = new Map<string, number[]>();
      for (const result of cases) {
        const score = result.scores.find((item) => item.metric === spec.name);
        if (score?.value === null || score?.value === undefined) continue;
        byCase.set(result.id, [...(byCase.get(result.id) ?? []), score.value]);
      }
      const groups = [...byCase.values()];
      passAllTrials = groups.filter((group) => group.every((v) => v === 1)).length / groups.length;
    }
    return {
      name: spec.name,
      description: spec.description,
      direction: spec.direction,
      unit: defaultUnit(spec),
      aggregate: how,
      value,
      samples: values.length,
      ...(passAllTrials === undefined ? {} : { passAllTrials }),
      ...judgeMetric(spec, value, mode, baseline?.[spec.name]),
    };
  });
}

/** Runs every case of a suite (times its trials) and scores the results. */
export async function runSuite(
  suite: AnySuite,
  context: EvalContext,
  options: RunOptions = {},
): Promise<SuiteResult> {
  const startedAt = new Date();
  const base = {
    suite: suite.name,
    description: suite.description,
    mode: context.mode,
    startedAt: startedAt.toISOString(),
  };
  const empty = { durationMs: 0, trials: 0, metrics: [], cases: [], errors: 0 };
  if (!suite.modes.includes(context.mode)) {
    return {
      ...base,
      ...empty,
      usage: context.usage.totals(),
      passed: true,
      skipped: `Doesn't run in ${context.mode} mode`,
    };
  }
  const trials = Math.max(1, options.trials ?? suite.trials?.[context.mode] ?? 1);
  const filter = options.filter?.toLowerCase();
  const cases = (suite.cases as EvalCase<unknown>[]).filter(
    (item) =>
      (!item.modes || item.modes.includes(context.mode)) &&
      (!filter ||
        item.id.toLowerCase().includes(filter) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(filter))),
  );

  let setup: unknown;
  try {
    setup = await suite.setup(context);
  } catch (error) {
    return {
      ...base,
      ...empty,
      usage: context.usage.totals(),
      passed: false,
      skipped: `Setup failed: ${errorText(error)}`,
    };
  }

  const results: CaseResult[] = [];
  const work = cases.flatMap((testCase) =>
    Array.from({ length: trials }, (_, trial) => ({ testCase, trial })),
  );
  try {
    await pool(work, suite.concurrency ?? DEFAULT_CONCURRENCY, async ({ testCase, trial }) => {
      const started = performance.now();
      const result: CaseResult = {
        id: testCase.id,
        trial,
        tags: testCase.tags ?? [],
        durationMs: 0,
        scores: [],
      };
      try {
        const output = await withTimeout(
          suite.run(setup, testCase, trial),
          suite.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
        result.durationMs = Math.round(performance.now() - started);
        result.scores = await suite.score(setup, testCase, output, context);
        if (suite.describe) result.output = suite.describe(output);
      } catch (error) {
        result.durationMs = Math.round(performance.now() - started);
        result.error = errorText(error);
      }
      results.push(result);
      options.onCase?.(result);
    });
  } finally {
    await suite.teardown?.(setup);
  }

  results.sort((a, b) => a.id.localeCompare(b.id) || a.trial - b.trial);
  const metrics = summarize(suite.metrics, results, trials, context.mode, options.baseline);
  const errors = results.filter((result) => result.error).length;
  return {
    ...base,
    durationMs: Date.now() - startedAt.getTime(),
    trials,
    metrics,
    cases: results,
    errors,
    usage: context.usage.totals(),
    passed: errors === 0 && metrics.every((metric) => !metric.failure),
  };
}
