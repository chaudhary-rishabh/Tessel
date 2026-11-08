import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage, UsageMetadata } from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import { CostCapExceededError } from "./errors";
import type { ModelInfo } from "./registry";
import {
  costNanoUsd,
  estimateTokens,
  NO_USAGE,
  type AiCallContext,
  type TokenUsage,
  type UsageRoute,
  type UsageStatus,
  type UsageTracker,
} from "./usage";

interface RunState {
  startedAt: number;
  inputCharacters: number;
  outputCharacters: number;
}

const textLength = (message: BaseMessage): number =>
  typeof message.content === "string"
    ? message.content.length
    : JSON.stringify(message.content).length;

export function usageFromMetadata(usage: UsageMetadata | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedInputTokens: usage.input_token_details?.cache_read ?? 0,
    reasoningTokens: usage.output_token_details?.reasoning ?? 0,
  };
}

/**
 * Records one usage event per chat model run, whether it succeeds, fails, or
 * is stopped. Attached to every TesselChatModel, so no model call can skip
 * the ledger. When a call fails or is stopped part way, tokens are estimated
 * from the text that was sent and streamed, and the event is marked estimated.
 */
export class UsageCallbackHandler extends BaseCallbackHandler {
  name = "tessel_usage";
  // Recording finishes before the call returns, so usage is never lost on exit
  // and callers can read it straight away.
  override awaitHandlers = true;

  private readonly runs = new Map<string, RunState>();

  constructor(
    private readonly tracker: UsageTracker,
    private readonly context: AiCallContext,
    private readonly model: ModelInfo,
  ) {
    super();
  }

  override handleChatModelStart(_llm: unknown, messages: BaseMessage[][], runId: string): void {
    const inputCharacters = messages
      .flat()
      .reduce((total, message) => total + textLength(message), 0);
    this.runs.set(runId, { startedAt: Date.now(), inputCharacters, outputCharacters: 0 });
  }

  override handleLLMNewToken(token: string, _idx: unknown, runId: string): void {
    const run = this.runs.get(runId);
    if (run) run.outputCharacters += token.length;
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const run = this.takeRun(runId);
    if (!run) return;
    const generation = output.generations.flat()[0] as ChatGeneration | undefined;
    const message = generation?.message as
      (BaseMessage & { usage_metadata?: UsageMetadata }) | undefined;
    const reported = usageFromMetadata(message?.usage_metadata);
    const metadata = message?.response_metadata as { tessel_route?: UsageRoute } | undefined;
    const route = metadata?.tessel_route ?? "gateway";
    const usage =
      reported ?? this.estimate(run, generation ? generation.text.length : run.outputCharacters);
    await this.record(run, route, "ok", usage, !reported, null);
  }

  override async handleLLMError(error: Error, runId: string): Promise<void> {
    const run = this.takeRun(runId);
    if (!run) return;
    // The cap check runs before any request is sent, so there is nothing to record.
    if (error instanceof CostCapExceededError) return;
    const aborted = error.name === "AbortError" || /abort/i.test(error.message);
    const status: UsageStatus = aborted ? "aborted" : "error";
    // A stopped call was billed for what it produced; a failed one wasn't billed.
    const usage = aborted ? this.estimate(run, run.outputCharacters) : NO_USAGE;
    await this.record(run, "gateway", status, usage, aborted, errorCode(error));
  }

  /** The run's state, once: a run that was already recorded returns undefined. */
  private takeRun(runId: string): RunState | undefined {
    const run = this.runs.get(runId);
    this.runs.delete(runId);
    return run;
  }

  private estimate(run: RunState, outputCharacters: number): TokenUsage {
    return {
      inputTokens: estimateTokens(run.inputCharacters),
      // Nothing streamed means the provider most likely produced nothing billable.
      outputTokens: outputCharacters > 0 ? estimateTokens(outputCharacters) : 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    };
  }

  private record(
    run: RunState,
    route: UsageRoute,
    status: UsageStatus,
    usage: TokenUsage,
    estimated: boolean,
    code: string | null,
  ): Promise<void> {
    return this.tracker.record({
      ...usage,
      workspaceId: this.context.workspaceId,
      userId: this.context.userId,
      requestId: this.context.requestId ?? null,
      feature: this.context.feature,
      modelId: this.model.id,
      route,
      status,
      costNanoUsd: costNanoUsd(this.model, usage),
      estimated,
      latencyMs: Date.now() - run.startedAt,
      errorCode: code,
    });
  }
}

function errorCode(error: Error): string {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return `http_${status}`;
  return error.name && error.name !== "Error" ? error.name : "unknown_error";
}
