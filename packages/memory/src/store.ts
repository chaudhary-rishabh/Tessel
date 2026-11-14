import {
  memories,
  memorySettings,
  messages,
  threads,
  users,
  withUserContext,
  workspaceMemories,
  workspaces,
  type Database,
  type MemoryRow,
  type WorkspaceMemoryRow,
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
  /** A team workspace, which has team memory too. */
  team?: boolean;
}

/** A team memory, with who wrote it. */
export type TeamMemoryRow = WorkspaceMemoryRow & { authorName: string | null };

/** Most memories a user keeps per workspace; the oldest automatic ones make room. */
export const MAX_MEMORIES = 200;
/** Most team memories a workspace keeps. */
export const MAX_TEAM_MEMORIES = 100;

export class MemoryLimitError extends Error {
  constructor(message = "Memory is full. Delete some memories to add more.") {
    super(message);
    this.name = "MemoryLimitError";
  }
}

/** Memory data access. Everything runs as the user, under row-level security. */
export function createMemoryStore(db: Database) {
  const owner = (actor: MemoryActor) =>
    and(eq(memories.userId, actor.userId), eq(memories.workspaceId, actor.workspaceId));

  const teamOf = (actor: MemoryActor) => eq(workspaceMemories.workspaceId, actor.workspaceId);

  return {
    async settings(actor: MemoryActor): Promise<MemorySettingsValue> {
      const { row, workspace } = await withUserContext(db, actor.userId, async (tx) => {
        const [settings] = await tx
          .select()
          .from(memorySettings)
          .where(
            and(
              eq(memorySettings.userId, actor.userId),
              eq(memorySettings.workspaceId, actor.workspaceId),
            ),
          );
        const [found] = await tx
          .select({ isPersonal: workspaces.isPersonal })
          .from(workspaces)
          .where(eq(workspaces.id, actor.workspaceId));
        return { row: settings, workspace: found };
      });
      return {
        memoryEnabled: row?.memoryEnabled ?? true,
        chatSearchEnabled: row?.chatSearchEnabled ?? true,
        team: workspace ? !workspace.isPersonal : false,
      };
    },

    /** Team memory, shared by everyone in a team workspace. */
    team: {
      list(actor: MemoryActor): Promise<TeamMemoryRow[]> {
        return withUserContext(db, actor.userId, (tx) =>
          tx
            .select({ memory: workspaceMemories, authorName: users.name })
            .from(workspaceMemories)
            .leftJoin(users, eq(users.id, workspaceMemories.createdBy))
            .where(teamOf(actor))
            .orderBy(desc(workspaceMemories.updatedAt))
            .then((rows) => rows.map((item) => ({ ...item.memory, authorName: item.authorName }))),
        );
      },

      async add(actor: MemoryActor, content: string): Promise<WorkspaceMemoryRow> {
        return withUserContext(db, actor.userId, async (tx) => {
          const [total] = await tx
            .select({ value: count() })
            .from(workspaceMemories)
            .where(teamOf(actor));
          if ((total?.value ?? 0) >= MAX_TEAM_MEMORIES) {
            throw new MemoryLimitError("Team memory is full. Delete some to add more.");
          }
          const [row] = await tx
            .insert(workspaceMemories)
            .values({
              workspaceId: actor.workspaceId,
              content,
              createdBy: actor.userId,
              updatedBy: actor.userId,
            })
            .returning();
          return row!;
        });
      },

      /** Undefined when it doesn't exist or the person may not change it. */
      async update(
        actor: MemoryActor,
        id: string,
        content: string,
      ): Promise<WorkspaceMemoryRow | undefined> {
        const [row] = await withUserContext(db, actor.userId, (tx) =>
          tx
            .update(workspaceMemories)
            .set({ content, updatedBy: actor.userId })
            .where(and(teamOf(actor), eq(workspaceMemories.id, id)))
            .returning(),
        );
        return row;
      },

      async remove(actor: MemoryActor, id: string): Promise<boolean> {
        const rows = await withUserContext(db, actor.userId, (tx) =>
          tx
            .delete(workspaceMemories)
            .where(and(teamOf(actor), eq(workspaceMemories.id, id)))
            .returning({ id: workspaceMemories.id }),
        );
        return rows.length > 0;
      },

      async exists(actor: MemoryActor, id: string): Promise<boolean> {
        const rows = await withUserContext(db, actor.userId, (tx) =>
          tx
            .select({ id: workspaceMemories.id })
            .from(workspaceMemories)
            .where(and(teamOf(actor), eq(workspaceMemories.id, id))),
        );
        return rows.length > 0;
      },
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
