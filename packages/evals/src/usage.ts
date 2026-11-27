import { nanoToUsd, type UsageEvent, type UsageLedger } from "@tessel/ai";

/** Totals every model call a suite makes, for the cost line in the report. */
export interface UsageMeter extends UsageLedger {
  readonly events: UsageEvent[];
  totals(): { calls: number; inputTokens: number; outputTokens: number; usd: number };
}

export function createUsageMeter(): UsageMeter {
  const events: UsageEvent[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
    totals() {
      return events.reduce(
        (sum, event) => ({
          calls: sum.calls + 1,
          inputTokens: sum.inputTokens + event.inputTokens,
          outputTokens: sum.outputTokens + event.outputTokens,
          usd: sum.usd + nanoToUsd(event.costNanoUsd),
        }),
        { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
      );
    },
  };
}
