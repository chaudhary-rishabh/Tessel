import type { DependencyCheck } from "@tessel/contracts";

export type DependencyCheckFn = () => Promise<DependencyCheck>;

const DEFAULT_TIMEOUT_MS = 2_000;

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Wraps a probe so it always resolves to a status, never throws, and never hangs. */
export function createCheck(
  name: string,
  probe: () => Promise<unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): DependencyCheckFn {
  return async () => {
    const startedAt = performance.now();
    const latency = () => Math.round(performance.now() - startedAt);
    try {
      await withTimeout(probe(), timeoutMs);
      return { name, status: "up", latencyMs: latency() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { name, status: "down", latencyMs: latency(), error: message };
    }
  };
}

/** Probe for services that expose an HTTP health endpoint (Qdrant, Neo4j). */
export function httpProbe(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): () => Promise<void> {
  return async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  };
}
