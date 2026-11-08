import type { UsageEvent, UsageLedger } from "../usage";

/** A usage ledger that keeps events in memory, for tests. */
export function memoryLedger(): UsageLedger & { events: UsageEvent[] } {
  const events: UsageEvent[] = [];
  return {
    events,
    record: async (event) => {
      events.push(event);
    },
  };
}
