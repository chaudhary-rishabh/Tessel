import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import type { Logger } from "@tessel/logger";
import OpenAI from "openai";
import type { CacheStats, KeyValueCache } from "./cache";
import { TesselChatModel, type ModelRoute } from "./chat-model";
import { GatewayEmbeddings, type EmbeddingRoute } from "./embeddings";
import type { AiEnv } from "./env";
import {
  AiError,
  AiNotConfiguredError,
  ContentBlockedError,
  ModelNotFoundError,
  ModelUnavailableError,
} from "./errors";
import {
  createModelModerator,
  noModeration,
  type ModerationResult,
  type Moderator,
} from "./moderation";
import { loadModelRegistry, type ModelInfo, type ModelRegistry } from "./registry";
import type { SpendGuard } from "./spend";
import { UsageCallbackHandler, usageFromMetadata } from "./usage-handler";
import {
  costNanoUsd,
  createUsageTracker,
  estimateTokens,
  NO_USAGE,
  type AiCallContext,
  type TokenUsage,
  type UsageLedger,
  type UsageRoute,
  type UsageTracker,
} from "./usage";

export interface ProviderCredentials {
  apiKey: string;
  baseURL?: string;
}

export interface AiOptions {
  gateway?: ProviderCredentials;
  /** Emergency routes used only when the gateway can't be reached. */
  fallback?: { openai?: ProviderCredentials; anthropic?: ProviderCredentials };
  registry: ModelRegistry;
  spend: SpendGuard;
  ledger: UsageLedger;
  moderation: { mode: "model" | "off"; failure: "allow" | "block" };
  logger: Logger;
  timeoutMs?: number;
  /** Caches embeddings of repeated text (queries, re-indexed chunks). */
  cache?: KeyValueCache;
}

/** How long a cached embedding is kept. Same text, same model: same vector. */
const EMBEDDING_CACHE_TTL_SECONDS = 7 * 86_400;

export interface ChatModelOptions {
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * A stable ID for the conversation (e.g. the thread), sent as the
   * gateway's session affinity header so follow-up calls reach the provider
   * that holds the prompt cache.
   */
  sessionId?: string;
}

export interface CompletionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** Defaults to the registry's default chat model. */
  model?: string;
  system?: string;
  messages: CompletionMessage[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface PreflightRequest {
  /** Defaults to the registry's default chat model. */
  model?: string;
  /** The user's message, for moderation. */
  text: string;
  hasImages?: boolean;
}

export interface PreflightResult {
  model: ModelInfo;
  moderation: ModerationResult;
}

export interface CompletionResult {
  text: string;
  model: ModelInfo;
  route: UsageRoute;
  usage: TokenUsage;
  costNanoUsd: number;
  moderation: ModerationResult;
}

export interface Ai {
  registry: ModelRegistry;
  spend: SpendGuard;
  moderator: Moderator;
  tracker: UsageTracker;
  /** True when at least one route (gateway or fallback) has credentials. */
  isConfigured: boolean;
  /** A chat model for `context`: capped, recorded, and with the emergency fallback. */
  chatModel(context: AiCallContext, modelId?: string, options?: ChatModelOptions): TesselChatModel;
  embeddings(context: AiCallContext, modelId?: string): GatewayEmbeddings;
  /** Embedding cache hits and misses since start. */
  embeddingCacheStats: CacheStats;
  /**
   * The checks before a user's message reaches a model: the model is
   * pickable (and can read images if any are attached), spend caps, and
   * moderation. A blocked message is recorded in the ledger.
   */
  preflight(context: AiCallContext, request: PreflightRequest): Promise<PreflightResult>;
  /** One non-streaming reply: cap check, moderation, model call, usage. */
  complete(context: AiCallContext, request: CompletionRequest): Promise<CompletionResult>;
}

/** Anthropic requires an output limit on every request. */
const ANTHROPIC_DEFAULT_MAX_TOKENS = 8_192;

export function createAi(options: AiOptions): Ai {
  const { gateway, fallback = {}, registry, spend, ledger, logger, timeoutMs = 120_000 } = options;
  const embeddingCacheStats: CacheStats = { hits: 0, misses: 0 };
  const tracker = createUsageTracker({ ledger, spend, logger });
  const isConfigured = Boolean(gateway || fallback.openai || fallback.anthropic);

  function chatRoutes(info: ModelInfo, chatOptions: ChatModelOptions): ModelRoute[] {
    const routes: ModelRoute[] = [];
    if (gateway) {
      routes.push({
        route: "gateway",
        model: new ChatOpenAI({
          model: info.id,
          apiKey: gateway.apiKey,
          configuration: {
            baseURL: gateway.baseURL,
            ...(chatOptions.sessionId
              ? { defaultHeaders: { "x-session-affinity": chatOptions.sessionId } }
              : {}),
          },
          // Prompt caching: the gateway adds cache markers for providers that need them (Anthropic).
          modelKwargs: { providerOptions: { gateway: { caching: "auto" } } },
          // The gateway already retries across providers; fail over to the next route quickly.
          maxRetries: 1,
          timeout: timeoutMs,
          streamUsage: true,
          useResponsesApi: false,
          ...(chatOptions.maxOutputTokens ? { maxTokens: chatOptions.maxOutputTokens } : {}),
          ...(chatOptions.temperature !== undefined
            ? { temperature: chatOptions.temperature }
            : {}),
        }),
      });
    }
    const target = info.fallback;
    const credentials = target ? fallback[target.provider] : undefined;
    if (target && credentials) {
      const model: BaseChatModel =
        target.provider === "anthropic"
          ? new ChatAnthropic({
              model: target.model,
              apiKey: credentials.apiKey,
              ...(credentials.baseURL ? { anthropicApiUrl: credentials.baseURL } : {}),
              maxRetries: 1,
              // The same time limit as the other routes, not the SDK's ten minutes.
              clientOptions: { timeout: timeoutMs },
              streamUsage: true,
              maxTokens: chatOptions.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
              ...(chatOptions.temperature !== undefined
                ? { temperature: chatOptions.temperature }
                : {}),
            })
          : new ChatOpenAI({
              model: target.model,
              apiKey: credentials.apiKey,
              configuration: credentials.baseURL ? { baseURL: credentials.baseURL } : {},
              maxRetries: 1,
              timeout: timeoutMs,
              streamUsage: true,
              useResponsesApi: false,
              ...(chatOptions.maxOutputTokens ? { maxTokens: chatOptions.maxOutputTokens } : {}),
              ...(chatOptions.temperature !== undefined
                ? { temperature: chatOptions.temperature }
                : {}),
            });
      routes.push({ route: "direct", model });
    }
    return routes;
  }

  function chatModel(context: AiCallContext, modelId?: string, chatOptions: ChatModelOptions = {}) {
    const info = modelId ? registry.get(modelId) : registry.forRole("chat");
    if (info.kind !== "chat") throw new ModelNotFoundError(info.id);
    const routes = chatRoutes(info, chatOptions);
    if (routes.length === 0) throw new AiNotConfiguredError();
    return new TesselChatModel({
      info,
      context,
      routes,
      spend,
      logger,
      callbacks: [new UsageCallbackHandler(tracker, context, info)],
    });
  }

  function embeddings(context: AiCallContext, modelId?: string) {
    const info = modelId ? registry.get(modelId) : registry.forRole("embedding");
    if (info.kind !== "embedding") throw new ModelNotFoundError(info.id);
    const routes: EmbeddingRoute[] = [];
    if (gateway) {
      routes.push({
        route: "gateway",
        model: info.id,
        client: new OpenAI({
          apiKey: gateway.apiKey,
          baseURL: gateway.baseURL,
          maxRetries: 1,
          timeout: timeoutMs,
        }),
      });
    }
    const credentials = info.fallback?.provider === "openai" ? fallback.openai : undefined;
    if (info.fallback && credentials) {
      routes.push({
        route: "direct",
        model: info.fallback.model,
        client: new OpenAI({
          apiKey: credentials.apiKey,
          baseURL: credentials.baseURL,
          maxRetries: 1,
          timeout: timeoutMs,
        }),
      });
    }
    if (routes.length === 0) throw new AiNotConfiguredError();
    return new GatewayEmbeddings({
      info,
      context,
      routes,
      tracker,
      spend,
      logger,
      cache: options.cache
        ? {
            store: options.cache,
            ttlSeconds: EMBEDDING_CACHE_TTL_SECONDS,
            stats: embeddingCacheStats,
          }
        : undefined,
    });
  }

  const moderator =
    options.moderation.mode === "off"
      ? noModeration
      : createModelModerator({
          createModel: (context) =>
            chatModel(context, registry.forRole("moderation").id, { temperature: 0 }),
          failure: options.moderation.failure,
          logger,
        });

  async function preflight(
    context: AiCallContext,
    request: PreflightRequest,
  ): Promise<PreflightResult> {
    if (!isConfigured) throw new AiNotConfiguredError();
    const info = registry.resolve(request.model, "chat");
    if (info.kind !== "chat" || !info.selectable) throw new ModelNotFoundError(info.id);
    if (request.hasImages && !info.capabilities.includes("vision")) {
      throw new AiError(
        400,
        "model_cannot_read_images",
        `${info.label} can't read images. Pick another model`,
        {
          model: info.id,
        },
      );
    }

    // Cheapest check first: a capped user shouldn't pay for moderation either.
    await spend.assertWithinBudget(context);

    const moderation = await moderator.check(context, request.text);
    if (!moderation.allowed) {
      await tracker.record({
        ...NO_USAGE,
        workspaceId: context.workspaceId,
        userId: context.userId,
        requestId: context.requestId ?? null,
        feature: context.feature,
        modelId: info.id,
        route: "gateway",
        status: "blocked",
        costNanoUsd: 0,
        estimated: false,
        latencyMs: 0,
        errorCode: "content_blocked",
      });
      throw new ContentBlockedError(moderation.categories);
    }
    return { model: info, moderation };
  }

  async function complete(
    context: AiCallContext,
    request: CompletionRequest,
  ): Promise<CompletionResult> {
    const latestUserText =
      request.messages.findLast((message) => message.role === "user")?.content ?? "";
    const { model: info, moderation } = await preflight(context, {
      model: request.model,
      text: latestUserText,
    });

    const messages: BaseMessage[] = [
      ...(request.system ? [new SystemMessage(request.system)] : []),
      ...request.messages.map((message) =>
        message.role === "user"
          ? new HumanMessage(message.content)
          : new AIMessage(message.content),
      ),
    ];

    let reply: AIMessageChunk;
    try {
      reply = await chatModel(context, info.id, {
        maxOutputTokens: request.maxOutputTokens,
      }).invoke(messages, {
        signal: request.signal,
      });
    } catch (error) {
      if (error instanceof AiError || request.signal?.aborted) throw error;
      throw new ModelUnavailableError(info.id, error);
    }

    const text = reply.text;
    const usage = usageFromMetadata(reply.usage_metadata) ?? {
      ...NO_USAGE,
      inputTokens: estimateTokens(
        messages.reduce((total, message) => total + message.text.length, 0),
      ),
      outputTokens: estimateTokens(text.length),
    };
    return {
      text,
      model: info,
      route: (reply.response_metadata?.tessel_route as UsageRoute | undefined) ?? "gateway",
      usage,
      costNanoUsd: costNanoUsd(info, usage),
      moderation,
    };
  }

  return {
    registry,
    spend,
    moderator,
    embeddingCacheStats,
    tracker,
    isConfigured,
    chatModel,
    embeddings,
    preflight,
    complete,
  };
}

/** Builds the options for createAi from the shared AI environment variables. */
export function aiOptionsFromEnv(
  env: AiEnv,
  deps: Pick<AiOptions, "spend" | "ledger" | "logger"> & {
    registry?: ModelRegistry;
    cache?: KeyValueCache;
  },
): AiOptions {
  const credentials = (apiKey?: string, baseURL?: string): ProviderCredentials | undefined =>
    apiKey ? { apiKey, ...(baseURL ? { baseURL } : {}) } : undefined;
  return {
    ...deps,
    registry: deps.registry ?? loadModelRegistry(env.AI_MODELS_FILE),
    gateway: credentials(env.AI_GATEWAY_API_KEY, env.AI_GATEWAY_URL),
    fallback: {
      openai: credentials(env.AI_FALLBACK_OPENAI_API_KEY, env.AI_FALLBACK_OPENAI_URL),
      anthropic: credentials(env.AI_FALLBACK_ANTHROPIC_API_KEY, env.AI_FALLBACK_ANTHROPIC_URL),
    },
    moderation: { mode: env.AI_MODERATION, failure: env.AI_MODERATION_ON_FAILURE },
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
  };
}
