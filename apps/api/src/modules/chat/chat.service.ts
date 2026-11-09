import { randomUUID } from "node:crypto";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Ai, AiCallContext, KnowledgeMode, ModelInfo } from "@tessel/ai";
import type {
  AgentModeName,
  Attachment,
  ChatMessage,
  SendMessageRequest,
  ThreadListResponse,
  ThreadResponse,
  ThreadSummary,
} from "@tessel/contracts";
import { sendMessageRequestSchema } from "@tessel/contracts";
import {
  withUserContext,
  type AgentRunRow,
  type Database,
  type MessageActivity,
  type MessageSource,
  type MessageStatus,
  type MessageToolCall,
} from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { storageKeys, type ObjectStore } from "@tessel/storage";
import type { UsageLimits } from "../billing/usage-limits";
import { errors } from "../../lib/errors";
import type { MemorySettingsValue, MemoryStore } from "@tessel/memory";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { classifyUpload } from "./chat.files";
import { buildModelMessages, type AttachmentFile } from "./chat.history";
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
  /** System prompt first, then the turns that fit. */
  history: BaseMessage[];
  /** How the reply is worked out, as picked in the chat box. */
  mode: AgentModeName;
  /** The user's memory settings, which decide the memory tools. */
  memorySettings: MemorySettingsValue;
  /** What the RAG router needs: recent turns as text, and the search settings. */
  knowledge: {
    mode: KnowledgeMode;
    hasDocuments: boolean;
    turns: { role: "user" | "assistant"; content: string }[];
  };
}

const TITLE_PROMPT =
  "Write a short title (at most six words) for a conversation that starts with the message below. Reply with the title only, no quotes.";

function fallbackTitle(text: string): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ");
  return words.length > 60 ? `${words.slice(0, 57)}…` : words || "New chat";
}

/** Long-term memories sent with each reply; the newest win when there are more. */
const MAX_PROMPT_MEMORIES = 60;

export function createChatService({
  db,
  ai,
  logger,
  objects,
  memory,
  limits,
}: {
  db: Database;
  ai: Ai;
  logger: Logger;
  objects: ObjectStore;
  memory: MemoryStore;
  /** Plan limits; without them, only the daily spend caps apply. */
  limits?: UsageLimits | undefined;
}) {
  /** The tier of the model a request will use; unknown models are left to the preflight to refuse. */
  const modelTier = (id: string | undefined): "free" | "pro" => {
    try {
      return ai.registry.resolve(id, "chat").tier;
    } catch {
      return "free";
    }
  };
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
      const id = randomUUID();
      const storageKey = storageKeys.attachment(actor.workspaceId, id);
      // Bytes first: a row never points at a file that isn't there.
      await objects.put(storageKey, file.buffer, classified.mediaType);
      const row = await withUserContext(db, actor.userId, (tx) =>
        chatRepository.insertAttachment(tx, {
          id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          ...classified,
          sizeBytes: file.buffer.length,
          storageKey,
        }),
      );
      return toAttachment(row);
    },

    async getAttachment(actor: Actor, attachmentId: string) {
      const row = await withUserContext(db, actor.userId, (tx) =>
        chatRepository.findAttachment(tx, { ...actor, attachmentId }),
      );
      if (!row) throw errors.notFound("Attachment not found");
      return { ...row, data: await objects.get(row.storageKey) };
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

      if (limits) {
        await limits.check(
          { workspaceId: actor.workspaceId, userId: actor.userId, requestId: actor.requestId },
          modelTier(request.model ?? existingThread?.modelId),
        );
      }
      const { model } = await ai.preflight(context, {
        model: request.model ?? existingThread?.modelId,
        text: request.content,
        hasImages: files.some((file) => file.kind === "image"),
      });

      const now = new Date();
      const saved = await withUserContext(db, actor.userId, async (tx) => {
        // A new message moves on from any action still waiting for approval.
        if (existingThread) await chatRepository.cancelWaitingRuns(tx, existingThread.id);
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
          agentMode: request.mode,
          // Strictly after the user's message, so ordering never ties.
          createdAt: new Date(now.getTime() + 1),
        });

        const rows = await chatRepository.listMessages(tx, thread.id);
        const history = rows.filter((row) => row.id !== assistantRow.id);
        const historyRows = await chatRepository.attachmentsForMessages(
          tx,
          history.filter((row) => row.role === "user").map((row) => row.id),
        );
        const hasDocuments =
          request.knowledge !== "off" &&
          (await chatRepository.hasReadyDocuments(tx, actor.workspaceId));
        return { thread, userRow, assistantRow, history, historyRows, hasDocuments };
      });

      // Files are read after the transaction, so storage latency never holds a connection.
      const historyFiles: AttachmentFile[] = await Promise.all(
        saved.historyRows.map(async (row) => ({ ...row, data: await objects.get(row.storageKey) })),
      );
      const memorySettings = await memory.settings(actor);
      const memories = memorySettings.memoryEnabled
        ? (await memory.list(actor)).slice(0, MAX_PROMPT_MEMORIES).map((row) => row.content)
        : [];
      return {
        context,
        model,
        thread: toThread(saved.thread),
        isNewThread: !existingThread,
        userMessage: toMessage(
          saved.userRow,
          files.map((file) => ({ ...file, messageId: saved.userRow.id })),
        ),
        assistantMessageId: saved.assistantRow.id,
        history: buildModelMessages(saved.history, historyFiles, now, {
          memories,
          summary: saved.thread.summary,
          summaryThrough: saved.thread.summaryThrough,
        }),
        mode: request.mode,
        memorySettings,
        knowledge: {
          mode: request.knowledge,
          hasDocuments: saved.hasDocuments,
          // Earlier turns only; the new message is passed separately.
          turns: saved.history
            .filter((row) => row.id !== saved.userRow.id && row.content && row.status !== "error")
            .map((row) => ({ role: row.role, content: row.content })),
        },
      };
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
        sources?: MessageSource[];
        toolCalls?: MessageToolCall[];
        activity?: MessageActivity[];
      },
    ): Promise<ChatMessage> {
      return withUserContext(db, actor.userId, async (tx) => {
        const row = await chatRepository.finishMessage(tx, messageId, result);
        if (!row) throw errors.notFound("Message not found");
        await chatRepository.updateThread(tx, row.threadId, { updatedAt: new Date() });
        return toMessage(row);
      });
    },

    /** Saves a reply paused for approval, with the run's checkpoint to continue from. */
    async pauseReply(
      actor: Actor,
      reply: { threadId: string; messageId: string; modelId: string },
      state: {
        content: string;
        toolCalls: MessageToolCall[];
        sources: MessageSource[];
        activity: MessageActivity[];
        checkpoint: Record<string, unknown>;
      },
    ): Promise<ChatMessage> {
      return withUserContext(db, actor.userId, async (tx) => {
        const row = await chatRepository.finishMessage(tx, reply.messageId, {
          content: state.content,
          status: "waiting",
          toolCalls: state.toolCalls,
          sources: state.sources,
          activity: state.activity,
        });
        if (!row) throw errors.notFound("Message not found");
        await chatRepository.saveRun(tx, {
          threadId: reply.threadId,
          messageId: reply.messageId,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          modelId: reply.modelId,
          checkpoint: state.checkpoint,
          sources: state.sources,
          status: "waiting",
        });
        await chatRepository.updateThread(tx, reply.threadId, { updatedAt: new Date() });
        return toMessage(row);
      });
    },

    /**
     * Takes the thread's paused run for a decision on `callId`. Only one
     * decision can claim a run, so a double click can't run a tool twice.
     */
    async claimRun(
      actor: Actor,
      threadId: string,
      callId: string,
    ): Promise<{ run: AgentRunRow; message: ChatMessage; thread: ThreadSummary }> {
      return withUserContext(db, actor.userId, async (tx) => {
        const thread = await chatRepository.findThread(tx, { ...actor, threadId });
        if (!thread) throw errors.notFound("Chat not found");
        const run = await chatRepository.claimWaitingRun(tx, thread.id);
        const pending = run?.checkpoint.pendingCallId;
        if (!run || pending !== callId) {
          if (run) await chatRepository.setRunStatus(tx, run.id, "waiting");
          throw errors.conflict(
            "approval_not_pending",
            "This action is no longer waiting for approval",
          );
        }
        const message = await chatRepository.findMessage(tx, run.messageId);
        if (!message) throw errors.notFound("Message not found");
        await chatRepository.finishMessage(tx, message.id, {
          content: message.content,
          status: "streaming",
        });
        return {
          run,
          message: toMessage({ ...message, status: "streaming" }),
          thread: toThread(thread),
        };
      });
    },

    async setRunStatus(actor: Actor, runId: string, status: AgentRunRow["status"]): Promise<void> {
      await withUserContext(db, actor.userId, (tx) =>
        chatRepository.setRunStatus(tx, runId, status),
      );
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
