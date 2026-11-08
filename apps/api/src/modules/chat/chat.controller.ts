import {
  attachmentParamsSchema,
  toolCallParamsSchema,
  toolDecisionRequestSchema,
  threadListQuerySchema,
  threadParamsSchema,
  updateThreadRequestSchema,
  workspaceParamsSchema,
} from "@tessel/contracts";
import type { Request, RequestHandler } from "express";
import { errors } from "../../lib/errors";
import { getAuth } from "../../middleware/require-auth";
import type { Actor, ChatService } from "./chat.service";
import { streamDecision, streamReply, type ReplyDependencies } from "./chat.stream";

function actorFor(req: Request): Actor {
  const { workspaceId } = workspaceParamsSchema.parse(req.params);
  return { userId: getAuth(req).userId, workspaceId, requestId: req.requestId };
}

/** Aborts when the client disconnects, which is how "stop" reaches the server. */
function disconnectSignal(res: Parameters<RequestHandler>[1]): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

export function createChatController(deps: ReplyDependencies & { service: ChatService }) {
  const { service } = deps;
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
    await deps.memory.forgetThread(threadId);
    res.status(204).end();
  };

  /** POST /workspaces/:workspaceId/chat — validates, saves, then streams the reply as SSE. */
  const send: RequestHandler = async (req, res) => {
    const actor = actorFor(req);
    // Errors before the stream opens become normal JSON error responses.
    const prepared = await service.prepareReply(actor, req.body);
    await streamReply({ deps, actor, prepared, res, signal: disconnectSignal(res) });
  };

  /**
   * POST /workspaces/:workspaceId/threads/:threadId/tool-calls/:callId/decision
   * Approves or declines the action a reply is waiting on, then streams the rest of the reply.
   */
  const decide: RequestHandler = async (req, res) => {
    const actor = actorFor(req);
    const { threadId, callId } = toolCallParamsSchema.parse(req.params);
    const { approved } = toolDecisionRequestSchema.parse(req.body);
    const claimed = await service.claimRun(actor, threadId, callId);
    await streamDecision({
      deps,
      actor,
      claimed,
      callId,
      approved,
      res,
      signal: disconnectSignal(res),
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
    decide,
    uploadAttachment,
    attachmentContent,
  };
}
