import type { Attachment, ChatMessage, ThreadSummary } from "@tessel/contracts";
import {
  attachments,
  messages,
  threads,
  type AttachmentRow,
  type MessageRow,
  type MessageStatus,
  type ThreadRow,
  type Transaction,
} from "@tessel/db";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";

export type AttachmentMeta = AttachmentRow;

export function toThread(row: ThreadRow): ThreadSummary {
  return {
    id: row.id,
    title: row.title,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toAttachment(row: AttachmentMeta): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mediaType: row.mediaType,
    kind: row.kind,
    sizeBytes: row.sizeBytes,
  };
}

export function toMessage(row: MessageRow, files: AttachmentMeta[] = []): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    modelId: row.modelId,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString(),
    attachments: files.map(toAttachment),
  };
}

const attachmentMeta = {
  id: attachments.id,
  workspaceId: attachments.workspaceId,
  userId: attachments.userId,
  messageId: attachments.messageId,
  filename: attachments.filename,
  mediaType: attachments.mediaType,
  kind: attachments.kind,
  sizeBytes: attachments.sizeBytes,
  storageKey: attachments.storageKey,
  createdAt: attachments.createdAt,
};

/**
 * Chat data access. Everything runs inside withUserContext; the explicit
 * owner filters are the first line of defence and row-level security the second.
 */
export const chatRepository = {
  listThreads(
    tx: Transaction,
    filter: { workspaceId: string; userId: string; before?: Date; limit: number },
  ): Promise<ThreadRow[]> {
    return tx
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.workspaceId, filter.workspaceId),
          eq(threads.userId, filter.userId),
          filter.before ? lt(threads.updatedAt, filter.before) : undefined,
        ),
      )
      .orderBy(desc(threads.updatedAt))
      .limit(filter.limit);
  },

  async findThread(
    tx: Transaction,
    ids: { workspaceId: string; userId: string; threadId: string },
  ): Promise<ThreadRow | undefined> {
    const [row] = await tx
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.id, ids.threadId),
          eq(threads.workspaceId, ids.workspaceId),
          eq(threads.userId, ids.userId),
        ),
      );
    return row;
  },

  async createThread(
    tx: Transaction,
    values: { workspaceId: string; userId: string; modelId: string },
  ): Promise<ThreadRow> {
    const [row] = await tx.insert(threads).values(values).returning();
    if (!row) throw new Error("Failed to create thread");
    return row;
  },

  async updateThread(
    tx: Transaction,
    threadId: string,
    values: Partial<Pick<ThreadRow, "title" | "modelId" | "updatedAt">>,
  ): Promise<ThreadRow | undefined> {
    const [row] = await tx.update(threads).set(values).where(eq(threads.id, threadId)).returning();
    return row;
  },

  async deleteThread(tx: Transaction, threadId: string): Promise<boolean> {
    const deleted = await tx
      .delete(threads)
      .where(eq(threads.id, threadId))
      .returning({ id: threads.id });
    return deleted.length > 0;
  },

  listMessages(tx: Transaction, threadId: string): Promise<MessageRow[]> {
    return tx
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
  },

  async insertMessage(
    tx: Transaction,
    values: Pick<MessageRow, "threadId" | "workspaceId" | "userId" | "role"> &
      Partial<Pick<MessageRow, "content" | "status" | "modelId" | "createdAt">>,
  ): Promise<MessageRow> {
    const [row] = await tx.insert(messages).values(values).returning();
    if (!row) throw new Error("Failed to insert message");
    return row;
  },

  async finishMessage(
    tx: Transaction,
    messageId: string,
    values: {
      content: string;
      status: MessageStatus;
      errorCode?: string | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
    },
  ): Promise<MessageRow | undefined> {
    const [row] = await tx
      .update(messages)
      .set(values)
      .where(eq(messages.id, messageId))
      .returning();
    return row;
  },

  /** Attachment rows for a set of messages. The bytes live in object storage. */
  attachmentsForMessages(tx: Transaction, messageIds: string[]): Promise<AttachmentMeta[]> {
    if (messageIds.length === 0) return Promise.resolve([]);
    return tx
      .select(attachmentMeta)
      .from(attachments)
      .where(inArray(attachments.messageId, messageIds))
      .orderBy(asc(attachments.createdAt));
  },

  async insertAttachment(
    tx: Transaction,
    values: Omit<AttachmentRow, "createdAt" | "messageId">,
  ): Promise<AttachmentMeta> {
    const [row] = await tx.insert(attachments).values(values).returning(attachmentMeta);
    if (!row) throw new Error("Failed to insert attachment");
    return row;
  },

  /** Unsent attachments owned by the user, among `ids`. */
  pendingAttachments(
    tx: Transaction,
    filter: { workspaceId: string; userId: string; ids: string[] },
  ): Promise<AttachmentMeta[]> {
    if (filter.ids.length === 0) return Promise.resolve([]);
    return tx
      .select(attachmentMeta)
      .from(attachments)
      .where(
        and(
          inArray(attachments.id, filter.ids),
          eq(attachments.workspaceId, filter.workspaceId),
          eq(attachments.userId, filter.userId),
          isNull(attachments.messageId),
        ),
      );
  },

  async attachToMessage(tx: Transaction, ids: string[], messageId: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.update(attachments).set({ messageId }).where(inArray(attachments.id, ids));
  },

  async findAttachment(
    tx: Transaction,
    filter: { workspaceId: string; userId: string; attachmentId: string },
  ): Promise<AttachmentRow | undefined> {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.id, filter.attachmentId),
          eq(attachments.workspaceId, filter.workspaceId),
          eq(attachments.userId, filter.userId),
        ),
      );
    return row;
  },
};
