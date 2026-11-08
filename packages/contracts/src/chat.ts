import { z } from "zod";

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

export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(["complete", "streaming", "stopped", "error"]),
  modelId: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  attachments: z.array(attachmentSchema),
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
  nextCursor: z.string().nullable(),
});

export const threadListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.iso.datetime().optional(),
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
});

/**
 * Server-sent events from POST /workspaces/:workspaceId/chat, in order:
 * start, token (many), done, then title for a new thread. error can replace
 * done at any point after start.
 */
export const chatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    thread: threadSummarySchema,
    userMessage: messageSchema,
    assistantMessageId: z.uuid(),
  }),
  z.object({ type: z.literal("token"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    status: z.enum(["complete", "stopped"]),
    message: messageSchema,
  }),
  z.object({ type: z.literal("title"), threadId: z.uuid(), title: z.string() }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
    assistantMessage: messageSchema.optional(),
  }),
]);

export type Attachment = z.infer<typeof attachmentSchema>;
export type ChatMessage = z.infer<typeof messageSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>;
export type ThreadResponse = z.infer<typeof threadResponseSchema>;
export type SendMessageRequest = z.input<typeof sendMessageRequestSchema>;
export type ChatEvent = z.infer<typeof chatEventSchema>;
