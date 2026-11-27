import type { MetricResult, SuiteResult } from "./types";

export function formatValue(
  metric: Pick<MetricResult, "unit">,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return "–";
  switch (metric.unit) {
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "count":
      return Number.isInteger(value) ? String(value) : value.toFixed(2);
    case "score":
      return value.toFixed(2);
  }
}

const status = (metric: MetricResult) =>
  metric.failure === "gate"
    ? "❌ below gate"
    : metric.failure === "regression"
      ? "⚠️ regressed"
      : "✅";

const comparison = (metric: MetricResult) => (metric.direction === "higher" ? "≥" : "≤");

/** One suite as a Markdown section: metric table, then failing cases. */
export function suiteMarkdown(result: SuiteResult): string {
  const heading = `### ${result.passed ? "✅" : "❌"} ${result.suite} (${result.mode})`;
  if (result.skipped) return `${heading}\n\n${result.skipped}\n`;
  const usage =
    result.usage.calls > 0
      ? `, ${result.usage.calls} model calls, $${result.usage.usd.toFixed(4)}`
      : "";
  const lines = [
    heading,
    "",
    `${result.description} ${new Set(result.cases.map((c) => c.id)).size} cases × ${result.trials} trial${result.trials === 1 ? "" : "s"}, ${(result.durationMs / 1000).toFixed(1)} s${usage}.`,
    "",
    "| Metric | Value | Gate | Baseline | Status |",
    "| --- | --- | --- | --- | --- |",
    ...result.metrics.map((metric) => {
      const value = formatValue(metric, metric.value);
      const consistency =
        metric.passAllTrials === undefined
          ? ""
          : ` (all trials: ${formatValue(metric, metric.passAllTrials)})`;
      const gate =
        metric.gate === undefined
          ? "–"
          : `${comparison(metric)} ${formatValue(metric, metric.gate)}`;
      return `| ${metric.name} | ${value}${consistency} | ${gate} | ${formatValue(metric, metric.baseline)} | ${status(metric)} |`;
    }),
  ];
  const failing = result.cases.filter(
    (item) => item.error || item.scores.some((score) => score.detail),
  );
  if (failing.length) {
    lines.push("", "<details><summary>Cases with notes</summary>", "");
    for (const item of failing.slice(0, 40)) {
      const notes = item.error
        ? [`error: ${item.error}`]
        : item.scores
            .filter((score) => score.detail)
            .map((score) => `${score.metric}: ${score.detail}`);
      lines.push(
        `- \`${item.id}\`${item.trial ? ` (trial ${item.trial + 1})` : ""}: ${notes.join("; ")}`,
      );
    }
    if (failing.length > 40) lines.push(`- …and ${failing.length - 40} more`);
    lines.push("", "</details>");
  }
  return `${lines.join("\n")}\n`;
}

export function runMarkdown(results: readonly SuiteResult[]): string {
  const passed = results.filter((result) => result.passed).length;
  const usd = results.reduce((sum, result) => sum + result.usage.usd, 0);
  const mode = results[0]?.mode ?? "mock";
  return [
    `## Evals (${mode}): ${passed} of ${results.length} suites passed${usd > 0 ? `, $${usd.toFixed(4)}` : ""}`,
    "",
    ...results.map(suiteMarkdown),
  ].join("\n");
}

/** A compact line per suite for the terminal. */
export function consoleLine(result: SuiteResult): string {
  if (result.skipped) return `${result.passed ? "–" : "✗"} ${result.suite}: ${result.skipped}`;
  const metrics = result.metrics
    .map(
      (metric) =>
        `${metric.name}=${formatValue(metric, metric.value)}${metric.failure ? ` (${metric.failure})` : ""}`,
    )
    .join("  ");
  const errors = result.errors ? `  errors=${result.errors}` : "";
  return `${result.passed ? "✓" : "✗"} ${result.suite}  ${metrics}${errors}`;
}
