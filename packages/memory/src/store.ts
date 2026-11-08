import {
  memories,
  memorySettings,
  messages,
  threads,
  withUserContext,
  type Database,
  type MemoryRow,
} from "@tessel/db";
import { and, asc, count, desc, eq } from "drizzle-orm";
import type { MemoryUpdates } from "./model";

export interface MemoryActor {
  userId: string;
  workspaceId: string;
}

export interface MemorySettingsValue {
  memoryEnabled: boolean;
  chatSearchEnabled: boolean;
}

/** Most memories a user keeps per workspace; the oldest automatic ones make room. */
export const MAX_MEMORIES = 200;

export class MemoryLimitError extends Error {
  constructor() {
    super("Memory is full. Delete some memories to add more.");
    this.name = "MemoryLimitError";
  }
}

/** Memory data access. Everything runs as the user, under row-level security. */
export function createMemoryStore(db: Database) {
  const owner = (actor: MemoryActor) =>
    and(eq(memories.userId, actor.userId), eq(memories.workspaceId, actor.workspaceId));

  return {
    async settings(actor: MemoryActor): Promise<MemorySettingsValue> {
      const [row] = await withUserContext(db, actor.userId, (tx) =>
        tx
          .select()
          .from(memorySettings)
          .where(
            and(
              eq(memorySettings.userId, actor.userId),
              eq(memorySettings.workspaceId, actor.workspaceId),
            ),
          ),
      );
      return {
        memoryEnabled: row?.memoryEnabled ?? true,
        chatSearchEnabled: row?.chatSearchEnabled ?? true,
      };
    },

    async saveSettings(
      actor: MemoryActor,
      patch: Partial<MemorySettingsValue>,
    ): Promise<MemorySettingsValue> {
      const [row] = await withUserContext(db, actor.userId, (tx) =>
        tx
          .insert(memorySettings)
          .values({ userId: actor.userId, workspaceId: actor.workspaceId, ...patch })
          .onConflictDoUpdate({
            target: [memorySettings.userId, memorySettings.workspaceId],
            set: patch,
          })
          .returning(),
      );
      return { memoryEnabled: row!.memoryEnabled, chatSearchEnabled: row!.chatSearchEnabled };
    },

    list(actor: MemoryActor): Promise<MemoryRow[]> {
      return withUserContext(db, actor.userId, (tx) =>
        tx.select().from(memories).where(owner(actor)).orderBy(desc(memories.updatedAt)),
      );
    },

    async add(
      actor: MemoryActor,
      value: { content: string; source: MemoryRow["source"]; sourceThreadId?: string | null },
    ): Promise<MemoryRow> {
      return withUserContext(db, actor.userId, async (tx) => {
        const [total] = await tx.select({ value: count() }).from(memories).where(owner(actor));
        if ((total?.value ?? 0) >= MAX_MEMORIES) {
          // Automatic memories give way to new ones; things the user wrote never do.
          const [oldest] = await tx
            .select({ id: memories.id })
            .from(memories)
            .where(and(owner(actor), eq(memories.source, "chat")))
            .orderBy(asc(memories.updatedAt))
            .limit(1);
          if (!oldest || value.source === "chat") throw new MemoryLimitError();
          await tx.delete(memories).where(eq(memories.id, oldest.id));
        }
        const [row] = await tx
          .insert(memories)
          .values({
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            content: value.content,
            source: value.source,
            sourceThreadId: value.sourceThreadId ?? null,
          })
          .returning();
        return row!;
      });
    },

    async update(actor: MemoryActor, id: string, content: string): Promise<MemoryRow | undefined> {
      const [row] = await withUserContext(db, actor.userId, (tx) =>
        tx
          .update(memories)
          .set({ content })
          .where(and(owner(actor), eq(memories.id, id)))
          .returning(),
      );
      return row;
    },

    async remove(actor: MemoryActor, id: string): Promise<boolean> {
      const rows = await withUserContext(db, actor.userId, (tx) =>
        tx
          .delete(memories)
          .where(and(owner(actor), eq(memories.id, id)))
          .returning({ id: memories.id }),
      );
      return rows.length > 0;
    },

    async clear(actor: MemoryActor): Promise<void> {
      await withUserContext(db, actor.userId, (tx) => tx.delete(memories).where(owner(actor)));
    },

    /** Applies what the extractor decided, in one transaction. */
    async apply(actor: MemoryActor, updates: MemoryUpdates, sourceThreadId: string): Promise<void> {
      await withUserContext(db, actor.userId, async (tx) => {
        for (const id of updates.remove)
          await tx.delete(memories).where(and(owner(actor), eq(memories.id, id)));
        for (const item of updates.update) {
          await tx
            .update(memories)
            .set({ content: item.content })
            .where(and(owner(actor), eq(memories.id, item.id)));
        }
        const [total] = await tx.select({ value: count() }).from(memories).where(owner(actor));
        const room = Math.max(0, MAX_MEMORIES - (total?.value ?? 0));
        const added = updates.add.slice(0, room);
        if (added.length) {
          await tx.insert(memories).values(
            added.map((content) => ({
              workspaceId: actor.workspaceId,
              userId: actor.userId,
              content,
              source: "chat" as const,
              sourceThreadId,
            })),
          );
        }
      });
    },

    /** A chat and its finished messages, oldest first. */
    async thread(actor: MemoryActor, threadId: string) {
      return withUserContext(db, actor.userId, async (tx) => {
        const [thread] = await tx
          .select()
          .from(threads)
          .where(and(eq(threads.id, threadId), eq(threads.userId, actor.userId)));
        if (!thread) return null;
        const rows = await tx
          .select()
          .from(messages)
          .where(eq(messages.threadId, threadId))
          .orderBy(asc(messages.createdAt), asc(messages.id));
        return {
          thread,
          messages: rows.filter(
            (row) => row.content && (row.status === "complete" || row.status === "stopped"),
          ),
        };
      });
    },

    async saveThread(
      actor: MemoryActor,
      threadId: string,
      values: { summary?: string; summaryThrough?: Date; memoryThrough?: Date },
    ): Promise<void> {
      await withUserContext(db, actor.userId, (tx) =>
        tx
          .update(threads)
          .set(values)
          .where(and(eq(threads.id, threadId), eq(threads.userId, actor.userId))),
      );
    },
  };
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
