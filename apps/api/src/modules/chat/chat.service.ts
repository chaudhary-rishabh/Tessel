import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Ai, AiCallContext, ModelInfo } from "@tessel/ai";
import type {
  Attachment,
  ChatMessage,
  SendMessageRequest,
  ThreadListResponse,
  ThreadResponse,
  ThreadSummary,
} from "@tessel/contracts";
import { sendMessageRequestSchema } from "@tessel/contracts";
import { withUserContext, type Database, type MessageStatus } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { classifyUpload } from "./chat.files";
import { buildModelMessages } from "./chat.history";
import { chatRepository, toAttachment, toMessage, toThread } from "./chat.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

/** Everything the stream needs once the message has been accepted and saved. */
export interface PreparedReply {
  context: AiCallContext;
  model: ModelInfo;
  thread: ThreadSummary;
  isNewThread: boolean;
  userMessage: ChatMessage;
  assistantMessageId: string;
  history: BaseMessage[];
}

const TITLE_PROMPT =
  "Write a short title (at most six words) for a conversation that starts with the message below. Reply with the title only, no quotes.";

function fallbackTitle(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words || "New chat";
}

export function createChatService({ db, ai, logger }: { db: Database; ai: Ai; logger: Logger }) {
  async function requireMembership(actor: Actor) {
    const workspace = await withUserContext(db, actor.userId, (tx) =>
      workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId),
    );
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  return {
    async listThreads(
      actor: Actor,
      { limit, before }: { limit: number; before?: string },
    ): Promise<ThreadListResponse> {
      await requireMembership(actor);
      const rows = await withUserContext(db, actor.userId, (tx) =>
        chatRepository.listThreads(tx, {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          limit: limit + 1,
          ...(before ? { before: new Date(before) } : {}),
        }),
      );
      const page = rows.slice(0, limit);
      return {
        threads: page.map(toThread),
        nextCursor: rows.length > limit ? (page.at(-1)?.updatedAt.toISOString() ?? null) : null,
      };
    },

    async getThread(actor: Actor, threadId: string): Promise<ThreadResponse> {
      return withUserContext(db, actor.userId, async (tx) => {
        const thread = await chatRepository.findThread(tx, { ...actor, threadId });
        if (!thread) throw errors.notFound("Chat not found");
        const rows = await chatRepository.listMessages(tx, thread.id);
        const files = await chatRepository.attachmentsForMessages(
          tx,
          rows.map((row) => row.id),
        );
        return {
          thread: toThread(thread),
          messages: rows.map((row) =>
            toMessage(
              row,
              files.filter((file) => file.messageId === row.id),
            ),
          ),
        };
      });
    },

    async renameThread(actor: Actor, threadId: string, title: string): Promise<ThreadSummary> {
      return withUserContext(db, actor.userId, async (tx) => {
        const thread = await chatRepository.findThread(tx, { ...actor, threadId });
        if (!thread) throw errors.notFound("Chat not found");
        const updated = await chatRepository.updateThread(tx, thread.id, { title });
        return toThread(updated ?? thread);
      });
    },

    async deleteThread(actor: Actor, threadId: string): Promise<void> {
      await withUserContext(db, actor.userId, async (tx) => {
        const thread = await chatRepository.findThread(tx, { ...actor, threadId });
        if (!thread) throw errors.notFound("Chat not found");
        await chatRepository.deleteThread(tx, thread.id);
      });
    },

    async uploadAttachment(
      actor: Actor,
      file: { originalname: string; buffer: Buffer },
    ): Promise<Attachment> {
      await requireMembership(actor);
      const classified = classifyUpload(file.originalname, file.buffer);
      const row = await withUserContext(db, actor.userId, (tx) =>
        chatRepository.insertAttachment(tx, {
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          ...classified,
          sizeBytes: file.buffer.length,
          data: file.buffer,
        }),
      );
      return toAttachment(row);
    },

    async getAttachment(actor: Actor, attachmentId: string) {
      const row = await withUserContext(db, actor.userId, (tx) =>
        chatRepository.findAttachment(tx, { ...actor, attachmentId }),
      );
      if (!row) throw errors.notFound("Attachment not found");
      return row;
    },

    /**
     * Checks and saves a new message, then returns what the stream needs.
     * Every check (membership, model, attachments, spend caps, moderation)
     * happens before anything is saved, so a refused message leaves no trace
     * except its ledger row.
     */
    async prepareReply(actor: Actor, input: SendMessageRequest): Promise<PreparedReply> {
      const request = sendMessageRequestSchema.parse(input);
      const context: AiCallContext = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        feature: "chat",
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
      };

      const { existingThread, files } = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await workspacesRepository.findForUser(
          tx,
          actor.workspaceId,
          actor.userId,
        );
        if (!workspace) throw errors.notFound("Workspace not found");
        const thread = request.threadId
          ? await chatRepository.findThread(tx, { ...actor, threadId: request.threadId })
          : undefined;
        if (request.threadId && !thread) throw errors.notFound("Chat not found");
        const pending = await chatRepository.pendingAttachments(tx, {
          ...actor,
          ids: request.attachmentIds,
        });
        if (pending.length !== new Set(request.attachmentIds).size) {
          throw errors.badRequest("invalid_attachments", "One or more attachments can't be used");
        }
        return { existingThread: thread, files: pending };
      });

      const { model } = await ai.preflight(context, {
        model: request.model ?? existingThread?.modelId,
        text: request.content,
        hasImages: files.some((file) => file.kind === "image"),
      });

      return withUserContext(db, actor.userId, async (tx) => {
        const now = new Date();
        const thread = existingThread
          ? ((await chatRepository.updateThread(tx, existingThread.id, {
              modelId: model.id,
              updatedAt: now,
            })) ?? existingThread)
          : await chatRepository.createThread(tx, {
              workspaceId: actor.workspaceId,
              userId: actor.userId,
              modelId: model.id,
            });
        const userRow = await chatRepository.insertMessage(tx, {
          threadId: thread.id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          role: "user",
          content: request.content,
          createdAt: now,
        });
        await chatRepository.attachToMessage(
          tx,
          files.map((file) => file.id),
          userRow.id,
        );
        const assistantRow = await chatRepository.insertMessage(tx, {
          threadId: thread.id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          role: "assistant",
          status: "streaming",
          modelId: model.id,
          // Strictly after the user's message, so ordering never ties.
          createdAt: new Date(now.getTime() + 1),
        });

        const rows = await chatRepository.listMessages(tx, thread.id);
        const history = rows.filter((row) => row.id !== assistantRow.id);
        const historyFiles = await chatRepository.attachmentFiles(
          tx,
          history.filter((row) => row.role === "user").map((row) => row.id),
        );

        return {
          context,
          model,
          thread: toThread(thread),
          isNewThread: !existingThread,
          userMessage: toMessage(
            userRow,
            files.map((file) => ({ ...file, messageId: userRow.id })),
          ),
          assistantMessageId: assistantRow.id,
          history: buildModelMessages(history, historyFiles, now),
        };
      });
    },

    async finishReply(
      actor: Actor,
      messageId: string,
      result: {
        content: string;
        status: MessageStatus;
        errorCode?: string | null;
        inputTokens?: number | null;
        outputTokens?: number | null;
      },
    ): Promise<ChatMessage> {
      return withUserContext(db, actor.userId, async (tx) => {
        const row = await chatRepository.finishMessage(tx, messageId, result);
        if (!row) throw errors.notFound("Message not found");
        await chatRepository.updateThread(tx, row.threadId, { updatedAt: new Date() });
        return toMessage(row);
      });
    },

    /** Names a new thread from its first message. Never fails: falls back to the first words. */
    async generateTitle(prepared: PreparedReply, firstMessage: string): Promise<string> {
      let title = fallbackTitle(firstMessage);
      try {
        const model = ai.chatModel(
          { ...prepared.context, feature: "title" },
          ai.registry.forRole("utility").id,
          {
            maxOutputTokens: 30,
          },
        );
        const reply = await model.invoke([
          new SystemMessage(TITLE_PROMPT),
          new HumanMessage(firstMessage.slice(0, 2_000)),
        ]);
        const cleaned = reply.text
          .replace(/^["'“”‘’\s#*]+|["'“”‘’\s.*]+$/g, "")
          .replace(/\s+/g, " ")
          .slice(0, 80);
        if (cleaned) title = cleaned;
      } catch (error) {
        logger.warn({ err: error }, "Title generation failed, using the first words");
      }
      await withUserContext(db, prepared.context.userId, (tx) =>
        chatRepository.updateThread(tx, prepared.thread.id, { title }),
      );
      return title;
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
