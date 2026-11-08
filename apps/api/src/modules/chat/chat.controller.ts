import type { Ai, RagPipeline } from "@tessel/ai";
import {
  attachmentParamsSchema,
  threadListQuerySchema,
  threadParamsSchema,
  updateThreadRequestSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import type { Logger } from "@tessel/logger";
import type { Request, RequestHandler } from "express";
import { errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, ChatService } from "./chat.service";
import { streamReply } from "./chat.stream";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

export function createChatController({
  service,
  ai,
  rag,
  logger,
}: {
  service: ChatService;
  ai: Ai;
  rag: RagPipeline;
  logger: Logger;
}) {
  const listThreads: RequestHandler = async (req, res) => {
    const query = threadListQuerySchema.parse(req.query);
    res.json(await service.listThreads(actorFor(req), query));
  };

  const getThread: RequestHandler = async (req, res) => {
    const { threadId } = threadParamsSchema.parse(req.params);
    res.json(await service.getThread(actorFor(req), threadId));
  };

  const renameThread: RequestHandler = async (req, res) => {
    const { threadId } = threadParamsSchema.parse(req.params);
    const { title } = updateThreadRequestSchema.parse(req.body);
    res.json(await service.renameThread(actorFor(req), threadId, title));
  };

  const deleteThread: RequestHandler = async (req, res) => {
    const { threadId } = threadParamsSchema.parse(req.params);
    await service.deleteThread(actorFor(req), threadId);
    res.status(204).end();
  };

  /** POST /workspaces/:workspaceId/chat — validates, saves, then streams the reply as SSE. */
  const send: RequestHandler = async (req, res) => {
    const actor = actorFor(req);
    // Errors before the stream opens become normal JSON error responses.
    const prepared = await service.prepareReply(actor, req.body);

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    await streamReply({
      ai,
      rag,
      service,
      logger,
      actor,
      prepared,
      firstMessage: prepared.userMessage.content,
      res,
      signal: controller.signal,
    });
  };

  const uploadAttachment: RequestHandler = async (req, res) => {
    if (!req.file) throw errors.badRequest("file_required", "Attach a file in the `file` field");
    res.status(201).json(await service.uploadAttachment(actorFor(req), req.file));
  };

  const attachmentContent: RequestHandler = async (req, res) => {
    const { attachmentId } = attachmentParamsSchema.parse(req.params);
    const file = await service.getAttachment(actorFor(req), attachmentId);
    const disposition = file.kind === "image" ? "inline" : "attachment";
    res.set({
      "Content-Type": file.kind === "image" ? file.mediaType : "text/plain; charset=utf-8",
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, max-age=3600",
    });
    res.end(file.data);
  };

  return {
    listThreads,
    getThread,
    renameThread,
    deleteThread,
    send,
    uploadAttachment,
    attachmentContent,
  };
}
