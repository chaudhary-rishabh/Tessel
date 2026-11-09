import { z } from "zod";
import { pageCursorSchema } from "./paging";

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;

export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mediaType: z.string(),
  kind: z.enum(["image", "text"]),
  sizeBytes: z.number().int(),
});

/** A document passage a reply can cite as [id]. */
export const messageSourceSchema = z.object({
  id: z.number().int().positive(),
  documentId: z.string(),
  filename: z.string(),
  page: z.number().int().nullable(),
  chunkIndex: z.number().int(),
  text: z.string(),
  /** Whether the reply actually cites it. */
  cited: z.boolean(),
});

/** A tool the reply used, or wants to use once the user approves. */
export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(["running", "waiting", "completed", "failed", "rejected", "cancelled"]),
  requiresApproval: z.boolean(),
  /** For approvals: what will happen, in words. */
  description: z.string().optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
});

export const knowledgeModeSchema = z.enum(["auto", "always", "off"]);

/**
 * How the reply is worked out: auto (one agent using tools as needed), plan
 * (plan, carry out each step, answer), reflect (draft, review, revise), or
 * team (a supervisor hands tasks to specialists).
 */
export const agentModeSchema = z.enum(["auto", "plan", "reflect", "team"]);

/** A visible stage of the work behind a reply: a plan step, a hand-off, a review. */
export const activityItemSchema = z.object({
  id: z.string(),
  kind: z.enum(["plan", "worker", "review"]),
  title: z.string(),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  detail: z.string().optional(),
});

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["complete", "streaming", "stopped", "error", "waiting"]),
  modelId: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  attachments: z.array(attachmentSchema),
  sources: z.array(messageSourceSchema).default([]),
  toolCalls: z.array(toolCallSchema).default([]),
  activity: z.array(activityItemSchema).default([]),
  agentMode: agentModeSchema.nullable().default(null),
});

export const threadSummarySchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  modelId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const threadListResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
  /** Pass as `before` to load older threads; null when there are no more. */
  nextCursor: pageCursorSchema.nullable(),
});

export const threadListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: pageCursorSchema.optional(),
  /** Finds chats whose title or messages contain this text. */
  q: z.string().trim().min(1).max(200).optional(),
});

export const threadResponseSchema = z.object({
  thread: threadSummarySchema,
  messages: z.array(messageSchema),
});

export const threadParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  threadId: z.uuid("Invalid thread ID"),
});

export const attachmentParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  attachmentId: z.uuid("Invalid attachment ID"),
});

export const updateThreadRequestSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120),
});

export const sendMessageRequestSchema = z.object({
  /** Omit to start a new thread. */
  threadId: z.uuid().optional(),
  model: z.string().max(120).optional(),
  content: z.string().trim().min(1, "Message is empty").max(100_000),
  attachmentIds: z.array(z.uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
  /** Whether to search the workspace's documents: the router decides, always, or never. */
  knowledge: knowledgeModeSchema.default("auto"),
  mode: agentModeSchema.default("auto"),
  /**
   * Rewrites a chat from one of its user messages: the message gets `content`
   * (the same text regenerates the reply), keeps its attachments, everything
   * after it is removed, and a new reply is written. Needs `threadId`.
   */
  editMessageId: z.uuid().optional(),
});

/**
 * Server-sent events from POST /workspaces/:workspaceId/chat, in order:
 * start, then status "searching" and sources when the documents are
 * searched, token (many), done, then title for a new thread. error can
 * replace done at any point after start. tool events arrive between tokens
 * whenever the agent uses a tool.
 *
 * POST /workspaces/:workspaceId/threads/:threadId/tool-calls/:callId/decision
 * continues a waiting reply with the same events, from "resume" onwards.
 */
export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    thread: threadSummarySchema,
    userMessage: messageSchema,
    assistantMessageId: z.uuid(),
  }),
  z.object({ type: z.literal("status"), stage: z.enum(["searching", "writing"]) }),
  /** The passages the reply may cite, numbered as they will appear in the text. */
  z.object({ type: z.literal("sources"), sources: z.array(messageSourceSchema) }),
  z.object({ type: z.literal("token"), text: z.string() }),
  /** A tool call started, finished, or is waiting for approval. Replaces earlier events for the same call. */
  z.object({ type: z.literal("tool"), call: toolCallSchema }),
  /** The reply's stages so far, in agent modes. Replaces the previous list. */
  z.object({ type: z.literal("activity"), items: z.array(activityItemSchema) }),
  z.object({
    type: z.literal("done"),
    /** "waiting": paused until the user decides on a tool call. */
    status: z.enum(["complete", "stopped", "waiting"]),
    message: messageSchema,
  }),
  z.object({ type: z.literal("title"), threadId: z.uuid(), title: z.string() }),
  /** First event when continuing a waiting reply after a decision. */
  z.object({ type: z.literal("resume"), message: messageSchema }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    assistantMessage: messageSchema.optional(),
  }),
]);

export type Attachment = z.infer<typeof attachmentSchema>;
export const toolDecisionRequestSchema = z.object({ approved: z.boolean() });

export const toolCallParamsSchema = z.object({
  workspaceId: z.uuid("Invalid workspace ID"),
  threadId: z.uuid("Invalid thread ID"),
  callId: z.string().min(1).max(200),
});

export type ChatMessage = z.infer<typeof messageSchema>;
export type ToolCallView = z.infer<typeof toolCallSchema>;
export type ToolDecisionRequest = z.infer<typeof toolDecisionRequestSchema>;
export type MessageSource = z.infer<typeof messageSourceSchema>;
export type KnowledgeMode = z.infer<typeof knowledgeModeSchema>;
export type AgentModeName = z.infer<typeof agentModeSchema>;
export type ActivityItemView = z.infer<typeof activityItemSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
export type SendMessageRequest = z.input<typeof sendMessageRequestSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;
