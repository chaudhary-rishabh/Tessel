import type { Logger } from "@tessel/logger";
import type { ModelInfo } from "./registry";
import type { SpendGuard } from "./spend";

/** What a model call was for. Shown in usage reports. */
export type UsageFeature =
  | "chat"
  | "completion"
  | "moderation"
  | "embedding"
  | "title"
  | "rag"
  | "agent"
  | "memory"
  | "search"
  | "graph"
  | "voice"
  | "image"
  | "video"
  | "transcription"
  | "ocr";

/** Who a model call is for. Always taken from the session, never from model output. */
export interface AiCallContext {
  workspaceId: string;
  userId: string;
  feature: UsageFeature;
  requestId?: string;
}

/** `gateway` is the normal path; `direct` is the emergency route straight to a provider. */
export type UsageRoute = "gateway" | "direct";
export type UsageStatus = "ok" | "error" | "aborted" | "blocked";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache (part of inputTokens). */
  cachedInputTokens: number;
  /** Output tokens spent on reasoning (part of outputTokens). */
  reasoningTokens: number;
}

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

/** One row of the usage ledger: one model call, successful or not. */
export interface UsageEvent extends TokenUsage {
  workspaceId: string;
  userId: string;
  requestId: string | null;
  feature: UsageFeature;
  modelId: string;
  route: UsageRoute;
  status: UsageStatus;
  /** Billions of a US dollar, so tiny embedding calls don't round to zero. */
  costNanoUsd: number;
  /** True when tokens were estimated from text length (the call failed or was stopped). */
  estimated: boolean;
  latencyMs: number;
  errorCode: string | null;
}

/** Where usage events are stored. The API and worker use the Postgres ledger in @tessel/db. */
export interface UsageLedger {
  record(event: UsageEvent): Promise<void>;
}

/** 1 USD per million tokens is 1,000 nano-dollars per token. */
const NANO_PER_TOKEN_PER_USD_PER_MILLION = 1_000;

/** The cost of a call from the registry's prices, in nano-dollars. */
export function costNanoUsd(model: Pick<ModelInfo, "pricing">, usage: TokenUsage): number {
  const { input, output, cachedInput = input } = model.pricing;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const dollarsPerMillion =
    (usage.inputTokens - cached) * input + cached * cachedInput + usage.outputTokens * output;
  return Math.round(dollarsPerMillion * NANO_PER_TOKEN_PER_USD_PER_MILLION);
}

export const nanoToUsd = (nano: number): number => nano / 1e9;
export const usdToNano = (usd: number): number => Math.round(usd * 1e9);

/** A rough token count for text whose real count is unknown. */
export const estimateTokens = (characters: number): number => Math.ceil(characters / 4);

export interface UsageTracker {
  /** Stores the event and adds its cost to today's spend. Never throws. */
  record(event: UsageEvent): Promise<void>;
}

export function createUsageTracker({
  ledger,
  spend,
  logger,
}: {
  ledger: UsageLedger;
  spend: SpendGuard;
  logger: Logger;
}): UsageTracker {
  return {
    async record(event) {
      const results = await Promise.allSettled([
        ledger.record(event),
        event.costNanoUsd > 0 ? spend.add(event, event.costNanoUsd) : Promise.resolve(),
      ]);
      const [ledgerResult, spendResult] = results;
      if (ledgerResult.status === "rejected") {
        // The full event goes to the logs so it can be replayed into the ledger.
        logger.error({ err: ledgerResult.reason, usageEvent: event }, "Failed to record AI usage");
      }
      if (spendResult.status === "rejected") {
        logger.warn({ err: spendResult.reason }, "Failed to update today's AI spend");
      }
    },
  };
}
