import { completionRequestSchema, workspaceParamsSchema } from "@tessel/contracts";
import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { AiService } from "./ai.service";

export function createAiController(service: AiService) {
  const listModels: RequestHandler = (_req, res) => {
    res.json(service.listModels());
  };

  const complete: RequestHandler = async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const request = completionRequestSchema.parse(req.body);

    // Stop the model call (and its billing) if the client goes away.
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    res.json(
      await service.complete(getAuth(req).userId, workspaceId, request, {
        requestId: req.requestId,
        signal: controller.signal,
      }),
    );
  };

  return { listModels, complete };
}
