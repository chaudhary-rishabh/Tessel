import type { Aggregate } from "../types";

/** The value below which `p` percent of `values` fall (nearest rank). */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function aggregate(values: readonly number[], how: Aggregate): number | null {
  if (values.length === 0) return null;
  switch (how) {
    case "mean":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    case "p50":
      return percentile(values, 50) ?? null;
    case "p95":
      return percentile(values, 95) ?? null;
  }
}

/** A 0/1 score from a condition, with the reason when it fails. */
export const check = (metric: string, ok: boolean, detail?: string) => ({
  metric,
  value: ok ? 1 : 0,
  ...(ok || detail === undefined ? {} : { detail }),
});
