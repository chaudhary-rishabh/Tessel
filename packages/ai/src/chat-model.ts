import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BaseChatModelParams,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { Logger } from "@tessel/logger";
import type { ModelInfo } from "./registry";
import type { SpendGuard } from "./spend";
import type { AiCallContext, UsageRoute } from "./usage";

export interface TesselChatCallOptions extends BaseChatModelCallOptions {
  /** OpenAI-format tool definitions; both routes understand them. */
  tools?: ReturnType<typeof convertToOpenAITool>[];
  /** "auto", "any", "none", or a tool name. Strings work on every route. */
  tool_choice?: string;
}

export interface ModelRoute {
  route: UsageRoute;
  model: BaseChatModel;
}

export interface TesselChatModelFields extends BaseChatModelParams {
  info: ModelInfo;
  context: AiCallContext;
  /** Tried in order: the gateway first, then the direct provider if configured. */
  routes: ModelRoute[];
  spend: SpendGuard;
  logger: Logger;
}

/** Request errors that would fail the same way on any route. */
const NON_RETRYABLE_STATUS = new Set([400, 404, 409, 413, 422]);

/**
 * Whether a failed call should be retried on the next route. Network errors,
 * timeouts, 5xx, 429, and gateway account problems (401, 402, 403) are; bad
 * requests and cancellations are not.
 */
export function shouldTryNextRoute(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (!(error instanceof Error)) return true;
  if (error.name === "AbortError") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status !== "number" || !NON_RETRYABLE_STATUS.has(status);
}

/**
 * A LangChain chat model that every model call in Tessel goes through. It
 * checks the daily spend caps before each call, calls the gateway, and falls
 * back to the provider directly when the gateway is unreachable. Usage is
 * recorded by the UsageCallbackHandler attached to it.
 *
 * Inner models are called through their `_generate` and
 * `_streamResponseChunks` methods, so only this model shows up as a run:
 * streaming callbacks see every token exactly once, whichever route served it.
 */
export class TesselChatModel extends BaseChatModel<TesselChatCallOptions, AIMessageChunk> {
  readonly info: ModelInfo;
  readonly context: AiCallContext;
  private readonly routes: ModelRoute[];
  private readonly spend: SpendGuard;
  private readonly logger: Logger;

  static override lc_name(): string {
    return "TesselChatModel";
  }

  constructor({ info, context, routes, spend, logger, ...fields }: TesselChatModelFields) {
    super(fields);
    if (routes.length === 0) throw new Error("TesselChatModel needs at least one route");
    this.info = info;
    this.context = context;
    this.routes = routes;
    this.spend = spend;
    this.logger = logger;
  }

  _llmType(): string {
    return "tessel";
  }

  override _identifyingParams(): Record<string, unknown> {
    return { model: this.info.id };
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<TesselChatCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, TesselChatCallOptions> {
    return this.withConfig({
      tools: tools.map((tool) => convertToOpenAITool(tool)),
      ...kwargs,
    } as Partial<TesselChatCallOptions>);
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    await this.spend.assertWithinBudget(this.context);
    let lastError: unknown;
    for (const [index, { route, model }] of this.routes.entries()) {
      try {
        const result = await model._generate(messages, options, runManager);
        for (const generation of result.generations) {
          generation.message.response_metadata = {
            ...generation.message.response_metadata,
            tessel_route: route,
          };
        }
        return result;
      } catch (error) {
        lastError = error;
        if (!this.canFallBack(index, error, options.signal)) throw error;
      }
    }
    throw lastError;
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    await this.spend.assertWithinBudget(this.context);
    // When the caller aborts or stops reading (the user pressed stop),
    // LangChain may report neither an end nor an error for the run, so the
    // stop is reported here and the run still reaches the usage ledger. The
    // usage handler ignores any later report for the same run.
    let outcome: "finished" | "failed" | "stopped" | undefined;
    const reportStop = () => {
      if (outcome) return;
      outcome = "stopped";
      const stopped = new Error("The response was stopped before it finished");
      stopped.name = "AbortError";
      void runManager?.handleLLMError(stopped);
    };
    options.signal?.addEventListener("abort", reportStop, { once: true });
    try {
      for (const [index, { route, model }] of this.routes.entries()) {
        let started = false;
        try {
          for await (const chunk of model._streamResponseChunks(messages, options, runManager)) {
            if (!started) {
              started = true;
              chunk.message.response_metadata = {
                ...chunk.message.response_metadata,
                tessel_route: route,
              };
            }
            yield chunk;
          }
          outcome ??= "finished";
          return;
        } catch (error) {
          // Once tokens have reached the caller, switching routes would mix two answers.
          if (started || !this.canFallBack(index, error, options.signal)) {
            outcome ??= "failed";
            throw error;
          }
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", reportStop);
      reportStop();
    }
  }

  private canFallBack(index: number, error: unknown, signal?: AbortSignal): boolean {
    const next = this.routes[index + 1];
    if (!next || !shouldTryNextRoute(error, signal)) return false;
    this.logger.warn(
      { err: error, model: this.info.id, from: this.routes[index]?.route, to: next.route },
      "Model call failed, trying the next route",
    );
    return true;
  }
}
