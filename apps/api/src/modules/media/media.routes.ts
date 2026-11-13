import {
  mediaContentQuerySchema,
  mediaParamsSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import { Router, type Request, type RequestHandler } from "express";
import { getAuth } from "../../middleware/require-auth";
import {
  createRateLimiter,
  userKey,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { Actor, MediaService } from "./media.service";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

/** Routes under /workspaces/:workspaceId/media: the user's gallery. */
export function createMediaRouter({
  service,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  service: MediaService;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);

  router.get("/status", (_req, res) => {
    res.json(service.status());
  });
  router.get("/", async (req, res) => {
    res.json(await service.list(actorFor(req), req.query));
  });
  // Making an image calls a model, so it shares the AI limit.
  router.post(
    "/images",
    createRateLimiter({ name: "images", ...rateLimit, storeFactory, key: userKey }),
    async (req, res) => {
      res
        .status(201)
        .json(await service.generateImage(actorFor(req), req.body, { moderate: true }));
    },
  );
  router.post(
    "/videos",
    createRateLimiter({ name: "videos", ...rateLimit, storeFactory, key: userKey }),
    async (req, res) => {
      res.status(201).json(await service.startVideo(actorFor(req), req.body, { moderate: true }));
    },
  );
  router.get("/:mediaId", async (req, res) => {
    const { mediaId } = mediaParamsSchema.parse(req.params);
    res.json(await service.get(actorFor(req), mediaId));
  });
  router.get("/:mediaId/content", async (req, res) => {
    const { mediaId } = mediaParamsSchema.parse(req.params);
    const { variant, download } = mediaContentQuerySchema.parse(req.query);
    const file = await service.file(actorFor(req), mediaId, variant);
    res.set({
      "Content-Type": file.mediaType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      // A media file never changes once made.
      "Cache-Control": "private, max-age=31536000, immutable",
    });
    res.end(file.data);
  });
  router.delete("/:mediaId", async (req, res) => {
    const { mediaId } = mediaParamsSchema.parse(req.params);
    await service.remove(actorFor(req), mediaId);
    res.status(204).end();
  });
  return router;
}
