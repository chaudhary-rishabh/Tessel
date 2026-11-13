import { createModelRegistry, readModelsConfig } from "@tessel/ai";
import { describe, expect, it } from "vitest";
import { usageEventFor } from "./usage";

const options = {
  subject: { workspaceId: "w", userId: "u", sessionId: "s" },
  registry: createModelRegistry(readModelsConfig()),
  rates: { sttUsdPerMinute: 0.006, ttsUsdPer1kChars: 0.04 },
  sttModelId: "elevenlabs/scribe-v2-realtime",
  ttsModelId: "elevenlabs/eleven-flash-v2.5",
};

describe("voice usage", () => {
  it("prices model tokens from the registry", () => {
    const event = usageEventFor(
      {
        type: "llm_metrics",
        label: "llm",
        requestId: "r",
        timestamp: 0,
        durationMs: 300,
        ttftMs: 150,
        cancelled: false,
        completionTokens: 1000,
        promptTokens: 2000,
        promptCachedTokens: 0,
        totalTokens: 3000,
        tokensPerSecond: 50,
        metadata: { modelName: "google/gemini-3.5-flash-lite" },
      },
      options,
    );
    // Gemini 3.5 Flash Lite: $0.30 in, $2.50 out per million tokens.
    expect(event).toMatchObject({
      feature: "voice",
      modelId: "google/gemini-3.5-flash-lite",
      requestId: "s",
      inputTokens: 2000,
      outputTokens: 1000,
      costNanoUsd: 2000 * 300 + 1000 * 2500,
      status: "ok",
    });
  });

  it("prices transcribed minutes and spoken characters", () => {
    const stt = usageEventFor(
      {
        type: "stt_metrics",
        label: "stt",
        requestId: "r",
        timestamp: 0,
        durationMs: 0,
        audioDurationMs: 30_000,
        streamed: true,
      },
      options,
    );
    expect(stt).toMatchObject({ modelId: options.sttModelId, costNanoUsd: 3_000_000 });

    const tts = usageEventFor(
      {
        type: "tts_metrics",
        label: "tts",
        requestId: "r",
        timestamp: 0,
        ttfbMs: 100,
        durationMs: 500,
        audioDurationMs: 2000,
        cancelled: false,
        charactersCount: 250,
        streamed: true,
      },
      options,
    );
    expect(tts).toMatchObject({ modelId: options.ttsModelId, costNanoUsd: 10_000_000 });
  });

  it("records nothing for metrics that cost nothing", () => {
    expect(
      usageEventFor(
        {
          type: "vad_metrics",
          label: "vad",
          timestamp: 0,
          idleTimeMs: 0,
          inferenceDurationTotalMs: 0,
          inferenceCount: 0,
        },
        options,
      ),
    ).toBeUndefined();
  });
});
