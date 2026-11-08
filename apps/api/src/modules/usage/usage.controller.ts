import { usageQuerySchema, workspaceParamsSchema } from "@tessel/contracts";
import type { RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import type { UsageService } from "./usage.service";

export function createUsageController(service: UsageService) {
  const summary: RequestHandler = async (req, res) => {
    const { workspaceId } = workspaceParamsSchema.parse(req.params);
    const { days } = usageQuerySchema.parse(req.query);
    res.json(await service.summary(getAuth(req).userId, workspaceId, days));
  };
  return { summary };
}
