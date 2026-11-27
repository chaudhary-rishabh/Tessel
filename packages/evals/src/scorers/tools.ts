/** Checks on the tool calls an agent made. */

export interface ObservedCall {
  name: string;
  args: Record<string, unknown>;
  /** As the agent recorded it: completed, rejected (declined), failed, and so on. */
  status?: string;
}

/**
 * An expected argument value: a literal (compared exactly, case-insensitive
 * for strings), a pattern, a list of phrases that must all appear, or a range.
 */
export type ArgMatcher =
  | string
  | number
  | boolean
  | null
  | RegExp
  | { includes: string[] }
  | { min?: number; max?: number }
  | { oneOf: (string | number)[] };

function matches(actual: unknown, expected: ArgMatcher): boolean {
  if (expected instanceof RegExp) return typeof actual === "string" && expected.test(actual);
  if (expected === null || typeof expected !== "object") {
    if (typeof expected === "string" && typeof actual === "string") {
      return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    }
    return actual === expected;
  }
  if ("includes" in expected) {
    const text =
      typeof actual === "string"
        ? actual.toLowerCase()
        : JSON.stringify(actual ?? "").toLowerCase();
    return expected.includes.every((part) => text.includes(part.toLowerCase()));
  }
  if ("oneOf" in expected) {
    return expected.oneOf.some((option) =>
      typeof option === "string" && typeof actual === "string"
        ? option.toLowerCase() === actual.toLowerCase()
        : option === actual,
    );
  }
  if (typeof actual !== "number") return false;
  return (
    (expected.min === undefined || actual >= expected.min) &&
    (expected.max === undefined || actual <= expected.max)
  );
}

/** Share of the expected arguments the call got right (missing ones count as wrong). */
export function argumentScore(
  args: Record<string, unknown>,
  expected: Readonly<Record<string, ArgMatcher>>,
): number {
  const keys = Object.keys(expected);
  if (keys.length === 0) return 1;
  return keys.filter((key) => matches(args[key], expected[key]!)).length / keys.length;
}

/**
 * Whether the calls were the right tools.
 * - exact: these names, in this order, and nothing else.
 * - ordered: these names appear in this order; others may come between.
 * - includes: each of these was called at least once, in any order.
 * - none: no tool was called (expected must be empty).
 */
export function toolChoiceScore(
  calls: readonly ObservedCall[],
  expected: readonly string[],
  match: "exact" | "ordered" | "includes" | "none" = "includes",
): number {
  const names = calls.map((call) => call.name);
  switch (match) {
    case "none":
      return names.length === 0 ? 1 : 0;
    case "exact":
      return names.length === expected.length && names.every((name, i) => name === expected[i])
        ? 1
        : 0;
    case "ordered": {
      let next = 0;
      for (const name of names) if (name === expected[next]) next += 1;
      return next === expected.length ? 1 : 0;
    }
    case "includes":
      return expected.every((name) => names.includes(name)) ? 1 : 0;
  }
}

/** 1 when no tool in `forbidden` was called. */
export function avoidedTools(calls: readonly ObservedCall[], forbidden: readonly string[]): number {
  return calls.some((call) => forbidden.includes(call.name)) ? 0 : 1;
}

/**
 * 1 when no declined tool was tried again: after the user rejects a call,
 * the agent must not call that tool again in the same run (with the same
 * arguments or reworded ones) unless the user asks.
 */
export function respectedDeclines(calls: readonly ObservedCall[]): number {
  const declined = new Set<string>();
  for (const call of calls) {
    if (declined.has(call.name)) return 0;
    if (call.status === "rejected") declined.add(call.name);
  }
  return 1;
}
