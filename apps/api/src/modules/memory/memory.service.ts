import { sparseVector, type Ai } from "@tessel/ai";
import {
  createMemoryRequestSchema,
  updateMemoryRequestSchema,
  updateMemorySettingsRequestSchema,
  type Memory,
  type MemoryResponse,
  type MemorySettings,
} from "@tessel/contracts";
import { withUserContext, type Database, type MemoryRow } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import {
  MemoryLimitError,
  type EpisodeIndex,
  type MemoryStore,
  type PastChat,
  type ThreadMemoryJob,
} from "@tessel/memory";
import { errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

/** Hands chats to the worker for summary, long-term, and episodic memory. */
export interface MemoryQueue {
  enqueue(job: ThreadMemoryJob): Promise<void>;
}

export interface MemoryDependencies {
  store: MemoryStore;
  episodes: EpisodeIndex;
  queue: MemoryQueue;
}

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    source: row.source,
    sourceThreadId: row.sourceThreadId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PAST_CHAT_RESULTS = 5;

/** What Tessel remembers about a user, which they can read, edit, and switch off. */
export function createMemoryService({
  db,
  ai,
  logger,
  memory,
}: {
  db: Database;
  ai: Ai;
  logger: Logger;
  memory: MemoryDependencies;
}) {
  const { store, episodes, queue } = memory;

  async function membership(actor: Actor) {
    const workspace = await withUserContext(db, actor.userId, (tx) =>
      workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId),
    );
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  const full = () => errors.conflict("memory_full", new MemoryLimitError().message);

  return {
    async get(actor: Actor): Promise<MemoryResponse> {
      await membership(actor);
      const [settings, rows] = await Promise.all([store.settings(actor), store.list(actor)]);
      return { settings, memories: rows.map(toMemory) };
    },

    async add(
      actor: Actor,
      input: unknown,
      source: "user" | "tool" = "user",
      threadId?: string,
    ): Promise<Memory> {
      const { content } = createMemoryRequestSchema.parse(input);
      await membership(actor);
      try {
        return toMemory(
          await store.add(actor, { content, source, sourceThreadId: threadId ?? null }),
        );
      } catch (error) {
        if (error instanceof MemoryLimitError) throw full();
        throw error;
      }
    },

    async update(actor: Actor, memoryId: string, input: unknown): Promise<Memory> {
      const { content } = updateMemoryRequestSchema.parse(input);
      const row = await store.update(actor, memoryId, content);
      if (!row) throw errors.notFound("Memory not found");
      return toMemory(row);
    },

    async remove(actor: Actor, memoryId: string): Promise<void> {
      if (!(await store.remove(actor, memoryId))) throw errors.notFound("Memory not found");
    },

    async clear(actor: Actor): Promise<void> {
      await membership(actor);
      await store.clear(actor);
    },

    async saveSettings(actor: Actor, input: unknown): Promise<MemorySettings> {
      const patch = updateMemorySettingsRequestSchema.parse(input);
      await membership(actor);
      const settings = await store.saveSettings(actor, patch);
      // Turning chat search off forgets what was indexed, not just stops using it.
      if (patch.chatSearchEnabled === false)
        await episodes.removeAll(actor.workspaceId, actor.userId);
      return settings;
    },

    settings: (actor: Actor) => store.settings(actor),

    /** Episodic memory: the user's earlier chats that match a query. */
    async searchPastChats(
      actor: Actor,
      query: string,
      excludeThreadId?: string,
    ): Promise<PastChat[]> {
      const context = {
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        feature: "memory" as const,
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
      };
      const dense = await ai.embeddings(context).embedQuery(query);
      const hits = await episodes.search({
        workspaceId: actor.workspaceId,
        userId: actor.userId,
        dense,
        sparse: sparseVector(query),
        limit: PAST_CHAT_RESULTS,
        ...(excludeThreadId ? { excludeThreadId } : {}),
      });
      return hits.map(({ payload }) => ({
        threadId: payload.thread_id,
        title: payload.title,
        summary: payload.summary,
        updatedAt: payload.updated_at,
      }));
    },

    /** Queues memory work for a chat after a reply; never fails the reply. */
    async afterReply(actor: Actor, threadId: string): Promise<void> {
      await queue
        .enqueue({ userId: actor.userId, workspaceId: actor.workspaceId, threadId })
        .catch((error: unknown) =>
          logger.warn({ err: error, threadId }, "Couldn't queue memory work"),
        );
    },

    /** Forgets a deleted chat's episode. */
    async forgetThread(threadId: string): Promise<void> {
      await episodes
        .remove(threadId)
        .catch((error: unknown) =>
          logger.warn({ err: error, threadId }, "Couldn't remove a chat from search"),
        );
    },
  };
}

export type MemoryService = ReturnType<typeof createMemoryService>;
