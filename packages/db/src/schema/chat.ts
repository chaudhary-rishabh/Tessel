import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export interface MessageSource {
  id: number;
  documentId: string;
  filename: string;
  page: number | null;
  chunkIndex: number;
  text: string;
  /** Whether the reply cites it. */
  cited: boolean;
}

/** A tool call as shown under a reply (see ToolCallRecord in @tessel/ai). */
export interface MessageToolCall {
  id: string;
  name: string;
  title: string;
  args: Record<string, unknown>;
  status: "running" | "waiting" | "completed" | "failed" | "rejected" | "cancelled";
  requiresApproval: boolean;
  description?: string;
  summary?: string;
  error?: string;
}

/** A visible stage of an orchestrated reply (see ActivityItem in @tessel/ai). */
export interface MessageActivity {
  id: string;
  kind: "plan" | "worker" | "review";
  title: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
}

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", [
  "complete",
  "streaming",
  "stopped",
  "error",
  // Paused until the user approves or declines a tool call.
  "waiting",
]);
export const agentRunStatus = pgEnum("agent_run_status", [
  "waiting",
  "running",
  "completed",
  "cancelled",
]);
export const attachmentKind = pgEnum("attachment_kind", ["image", "text"]);

/**
 * A conversation. Chats are private to the member who started them; RLS
 * policies for these tables live in migration 0003_chat.sql.
 */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null until the first reply, when a title is generated. */
    title: text("title"),
    /** The model the last reply used; new replies default to it. */
    modelId: text("model_id").notNull(),
    /** Summary memory: a running summary of turns too old to send in full. */
    summary: text("summary"),
    /** The last message the summary covers. */
    summaryThrough: timestamp("summary_through", { withTimezone: true }),
    /** The last message long-term memory has looked at. */
    memoryThrough: timestamp("memory_through", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last activity, for ordering the chat list. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("threads_owner_recent_idx").on(table.workspaceId, table.userId, table.updatedAt.desc()),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull().default(""),
    status: messageStatus("status").notNull().default("complete"),
    /** For assistant messages: the model that wrote it. */
    modelId: text("model_id"),
    errorCode: text("error_code"),
    /** For assistant messages: the document passages the reply could cite, numbered from 1. */
    sources: jsonb("sources").$type<MessageSource[]>().notNull().default([]),
    /** For assistant messages: the tools the reply used, in order. */
    toolCalls: jsonb("tool_calls").$type<MessageToolCall[]>().notNull().default([]),
    /** For assistant messages: how the reply was worked out (plan steps, team hand-offs, reviews). */
    activity: jsonb("activity").$type<MessageActivity[]>().notNull().default([]),
    /** Set when the message was spoken in a voice conversation. */
    voiceSessionId: uuid("voice_session_id"),
    /** For assistant messages: the agent mode the user picked. */
    agentMode: text("agent_mode"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_thread_created_idx").on(table.threadId, table.createdAt)],
);

/**
 * Files attached to a message (images up to 5 MB, text up to 1 MB). The
 * bytes live in S3 at storage_key, under the workspace's prefix.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null until the message it belongs to is sent. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    kind: attachmentKind("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("attachments_message_idx").on(table.messageId),
    index("attachments_owner_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * An agent run paused for approval: everything needed to continue it once
 * the user decides. One per assistant message; private to its owner.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: agentRunStatus("status").notNull().default("waiting"),
    modelId: text("model_id").notNull(),
    /** The agent's checkpoint: conversation so far, tool calls, pending call. */
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
    /** Citation sources collected so far, so numbering continues after approval. */
    sources: jsonb("sources").$type<MessageSource[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("agent_runs_thread_status_idx").on(table.threadId, table.status)],
);

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type MessageStatus = (typeof messageStatus.enumValues)[number];
