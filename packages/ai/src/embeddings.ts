import { Embeddings } from "@langchain/core/embeddings";
import type { Logger } from "@tessel/logger";
import type OpenAI from "openai";
import { shouldTryNextRoute } from "./chat-model";
import type { ModelInfo } from "./registry";
import type { SpendGuard } from "./spend";
import {
  costNanoUsd,
  usdToNano,
  type AiCallContext,
  type UsageRoute,
  type UsageTracker,
} from "./usage";

export interface EmbeddingRoute {
  route: UsageRoute;
  client: OpenAI;
  /** Model name on this route: `openai/text-embedding-3-small` on the gateway, without the prefix direct. */
  model: string;
}

const BATCH_SIZE = 128;

interface GatewayCostMetadata {
  providerMetadata?: { gateway?: { cost?: string } };
}

/**
 * LangChain embeddings through the gateway's OpenAI-compatible endpoint.
 * Each request checks the spend caps first and is recorded in the usage
 * ledger, using the cost the gateway reports when it reports one.
 */
export class GatewayEmbeddings extends Embeddings {
  constructor(
    private readonly options: {
      info: ModelInfo;
      context: AiCallContext;
      routes: EmbeddingRoute[];
      tracker: UsageTracker;
      spend: SpendGuard;
      logger: Logger;
    },
  ) {
    super({ maxRetries: 0 });
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      vectors.push(...(await this.embedBatch(texts.slice(start, start + BATCH_SIZE))));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    if (!vector) throw new Error("The embedding response was empty");
    return vector;
  }

  private async embedBatch(input: string[]): Promise<number[][]> {
    const { info, context, routes, tracker, spend, logger } = this.options;
    await spend.assertWithinBudget(context);

    let lastError: unknown;
    for (const [index, { route, client, model }] of routes.entries()) {
      const startedAt = Date.now();
      try {
        const response = await client.embeddings.create({
          model,
          input,
          ...(info.dimensions ? { dimensions: info.dimensions } : {}),
        });
        const inputTokens = response.usage?.prompt_tokens ?? 0;
        const usage = { inputTokens, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
        const reportedCost = Number(
          (response as GatewayCostMetadata).providerMetadata?.gateway?.cost,
        );
        await tracker.record({
          ...usage,
          workspaceId: context.workspaceId,
          userId: context.userId,
          requestId: context.requestId ?? null,
          feature: context.feature,
          modelId: info.id,
          route,
          status: "ok",
          costNanoUsd: Number.isFinite(reportedCost)
            ? usdToNano(reportedCost)
            : costNanoUsd(info, usage),
          estimated: false,
          latencyMs: Date.now() - startedAt,
          errorCode: null,
        });
        return [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      } catch (error) {
        lastError = error;
        const hasNext = index < routes.length - 1;
        if (!hasNext || !shouldTryNextRoute(error)) break;
        logger.warn(
          { err: error, model: info.id, from: route },
          "Embedding call failed, trying the next route",
        );
      }
    }

    await tracker.record({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      workspaceId: context.workspaceId,
      userId: context.userId,
      requestId: context.requestId ?? null,
      feature: context.feature,
      modelId: info.id,
      route: routes.at(-1)?.route ?? "gateway",
      status: "error",
      costNanoUsd: 0,
      estimated: false,
      latencyMs: 0,
      errorCode: lastError instanceof Error ? lastError.name : "unknown_error",
    });
    throw lastError;
  }
}
