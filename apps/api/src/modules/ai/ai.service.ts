import type { Ai } from "@tessel/ai";
import { nanoToUsd } from "@tessel/ai";
import type { CompletionRequest, CompletionResponse, ModelListResponse } from "@tessel/contracts";
import { withUserContext, type Database } from "@tessel/db";
import { errors } from "../../lib/errors";
import { modelTier, type UsageLimits } from "../billing/usage-limits";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export function createAiService({
  db,
  ai,
  limits,
}: {
  db: Database;
  ai: Ai;
  limits?: UsageLimits | undefined;
}) {
  return {
    listModels(): ModelListResponse {
      return {
        models: ai.registry.list({ kind: "chat", selectable: true }).map((model) => ({
          id: model.id,
          label: model.label,
          description: model.description,
          provider: model.provider,
          contextWindow: model.contextWindow,
          capabilities: model.capabilities,
          tier: model.tier,
        })),
        defaultModel: ai.registry.forRole("chat").id,
      };
    },

    async complete(
      userId: string,
      workspaceId: string,
      request: CompletionRequest,
      { requestId, signal }: { requestId?: string; signal?: AbortSignal },
    ): Promise<CompletionResponse> {
      const workspace = await withUserContext(db, userId, (tx) =>
        workspacesRepository.findForUser(tx, workspaceId, userId),
      );
      if (!workspace) throw errors.notFound("Workspace not found");
      if (limits) {
        await limits.check(
          { workspaceId, userId, requestId },
          modelTier(ai.registry, request.model),
        );
      }

      const result = await ai.complete(
        { userId, workspaceId, feature: "completion", ...(requestId ? { requestId } : {}) },
        { ...request, signal },
      );
      return {
        message: { role: "assistant", content: result.text },
        model: result.model.id,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          costUsd: nanoToUsd(result.costNanoUsd),
        },
      };
    },
  };
}

export type AiService = ReturnType<typeof createAiService>;
