import { MAX_IMAGE_BYTES } from "@tessel/contracts";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
  createRateLimiter,
  userKey,
  type RateLimitRule,
  type RateLimitStoreFactory,
} from "../../middleware/rate-limit";
import type { createChatController } from "./chat.controller";

/** Files are held in memory up to the largest allowed size, then checked by content. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 },
});

/** Routes under /workspaces/:workspaceId for chat threads, messages, and attachments. */
export function createChatRouter({
  controller,
  authenticate,
  rateLimit,
  storeFactory,
}: {
  controller: ReturnType<typeof createChatController>;
  authenticate: RequestHandler;
  rateLimit: RateLimitRule;
  storeFactory?: RateLimitStoreFactory | undefined;
}): Router {
  const perUser = (name: string) =>
    createRateLimiter({ name, ...rateLimit, storeFactory, key: userKey });

  const router = Router({ mergeParams: true });
  router.use(authenticate);
  router.post("/chat", perUser("ai"), controller.send);
  router.post("/threads/:threadId/tool-calls/:callId/decision", perUser("ai"), controller.decide);
  router.get("/threads", controller.listThreads);
  router.get("/threads/:threadId", controller.getThread);
  router.patch("/threads/:threadId", controller.renameThread);
  router.delete("/threads/:threadId", controller.deleteThread);
  router.post(
    "/attachments",
    perUser("attachments"),
    upload.single("file"),
    controller.uploadAttachment,
  );
  router.get("/attachments/:attachmentId/content", controller.attachmentContent);
  return router;
}
