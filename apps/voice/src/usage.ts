import type { metrics } from "@livekit/agents";
import {
  costNanoUsd,
  usdToNano,
  type ModelRegistry,
  type UsageEvent,
  type UsageTracker,
} from "@tessel/ai";

export interface VoiceUsageSubject {
  workspaceId: string;
  userId: string;
  /** The voice session, kept as the ledger's request ID so its calls group together. */
  sessionId: string;
}

export interface VoiceRates {
  sttUsdPerMinute: number;
  ttsUsdPer1kChars: number;
}

const base = (subject: VoiceUsageSubject) => ({
  workspaceId: subject.workspaceId,
  userId: subject.userId,
  requestId: subject.sessionId,
  feature: "voice" as const,
  route: "gateway" as const,
  estimated: false,
  errorCode: null,
});

/**
 * Turns LiveKit's per-stage metrics into usage ledger rows: model tokens at
 * the registry's prices, transcribed minutes, and spoken characters at the
 * speech rates. Each row also counts toward today's spend caps.
 */
export function usageEventFor(
  m: metrics.AgentMetrics,
  {
    subject,
    registry,
    rates,
    sttModelId,
    ttsModelId,
  }: {
    subject: VoiceUsageSubject;
    registry: ModelRegistry;
    rates: VoiceRates;
    sttModelId: string;
    ttsModelId: string;
  },
): UsageEvent | undefined {
  if (m.type === "llm_metrics") {
    const usage = {
      inputTokens: m.promptTokens,
      outputTokens: m.completionTokens,
      cachedInputTokens: m.promptCachedTokens,
      reasoningTokens: m.reasoningTokens ?? 0,
    };
    let modelId = m.metadata?.modelName ?? "";
    let cost = 0;
    try {
      const model = registry.get(modelId);
      modelId = model.id;
      cost = costNanoUsd(model, usage);
    } catch {
      // A model the registry no longer lists still gets a row, at no cost.
    }
    return {
      ...base(subject),
      ...usage,
      modelId: modelId || "unknown",
      status: m.cancelled ? "aborted" : "ok",
      costNanoUsd: cost,
      latencyMs: Math.round(m.durationMs),
    };
  }
  if (m.type === "stt_metrics") {
    if (m.audioDurationMs <= 0) return undefined;
    return {
      ...base(subject),
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      modelId: sttModelId,
      status: "ok",
      costNanoUsd: usdToNano((m.audioDurationMs / 60_000) * rates.sttUsdPerMinute),
      latencyMs: Math.round(m.durationMs),
    };
  }
  if (m.type === "tts_metrics") {
    if (m.charactersCount <= 0) return undefined;
    return {
      ...base(subject),
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      modelId: ttsModelId,
      status: m.cancelled ? "aborted" : "ok",
      costNanoUsd: usdToNano((m.charactersCount / 1000) * rates.ttsUsdPer1kChars),
      latencyMs: Math.round(m.durationMs),
    };
  }
  return undefined;
}

/** Records every metric that costs something. Never throws (the tracker logs failures). */
export function createVoiceUsage(
  tracker: UsageTracker,
  options: Parameters<typeof usageEventFor>[1],
) {
  return {
    record(m: metrics.AgentMetrics): Promise<void> {
      const event = usageEventFor(m, options);
      return event ? tracker.record(event) : Promise.resolve();
    },
  };
}
