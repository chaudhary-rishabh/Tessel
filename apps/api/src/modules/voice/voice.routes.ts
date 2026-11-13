import { voiceSessionParamsSchema, workspaceParamsSchema } from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import {
  createRateLimiter,
  userKey,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { Actor, VoiceService } from "./voice.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

/** Routes under /workspaces/:workspaceId/voice. */
export function createVoiceRouter({
  service,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  service: VoiceService;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.get("/status", (_req, res) => {
    res.json(service.status());
  });
  // Starting a conversation calls models for as long as it runs, so it shares the AI limit.
  router.post(
    "/sessions",
    createRateLimiter({ name: "voice", ...rateLimit, storeFactory, key: userKey }),
    async (req, res) => {
      res.status(201).json(await service.start(actorFor(req), req.body));
    },
  );
  router.post("/sessions/:sessionId/end", async (req, res) => {
    const { sessionId } = voiceSessionParamsSchema.parse(req.params);
    await service.end(actorFor(req), sessionId);
    res.status(204).end();
  });
  return router;
}
