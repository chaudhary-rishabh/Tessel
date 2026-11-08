import { sparseVector, type Ai } from "@tessel/ai";
import type { Logger } from "@tessel/logger";
import type { EpisodeIndex } from "./episodes";
import { extractMemories, summarizeTurns, type Turn } from "./model";
import type { MemoryActor, MemoryStore } from "./store";

/** Summarize once this many messages sit outside the summary, keeping the newest in full. */
export const SUMMARY_TRIGGER = 24;
export const KEEP_RECENT = 12;
/** How many recent turns the extractor sees for context, besides the new ones. */
const CONTEXT_TURNS = 4;
const EPISODE_CHARACTERS = 3_000;

export interface ThreadMemoryJob extends MemoryActor {
  threadId: string;
}

export interface ThreadMemoryReport {
  summarized: boolean;
  added: number;
  updated: number;
  removed: number;
  indexed: boolean;
}

const toTurn = (row: { role: "user" | "assistant"; content: string }): Turn => ({
  role: row.role,
  content: row.content,
});

/**
 * Runs after replies (from the worker, debounced per chat):
 * - summary memory: folds old turns into the chat's running summary;
 * - long-term memory: saves lasting facts about the user from new turns;
 * - episodic memory: indexes what the chat is about, for search_past_chats.
 * Each part follows the user's memory settings and fails on its own.
 */
export async function processThreadMemory(
  {
    store,
    ai,
    episodes,
    logger,
  }: { store: MemoryStore; ai: Ai; episodes: EpisodeIndex; logger: Logger },
  job: ThreadMemoryJob,
): Promise<ThreadMemoryReport> {
  const report: ThreadMemoryReport = {
    summarized: false,
    added: 0,
    updated: 0,
    removed: 0,
    indexed: false,
  };
  const loaded = await store.thread(job, job.threadId);
  if (!loaded) return report;
  const { thread, messages } = loaded;
  const settings = await store.settings(job);
  const context = { userId: job.userId, workspaceId: job.workspaceId, feature: "memory" as const };
  const utility = () =>
    ai.chatModel(context, ai.registry.forRole("utility").id, { temperature: 0 });

  // Summary memory
  let summary = thread.summary;
  const unsummarized = messages.filter(
    (row) => !thread.summaryThrough || row.createdAt > thread.summaryThrough,
  );
  if (unsummarized.length >= SUMMARY_TRIGGER) {
    const older = unsummarized.slice(0, unsummarized.length - KEEP_RECENT);
    try {
      summary = await summarizeTurns(utility(), {
        previous: thread.summary,
        turns: older.map(toTurn),
      });
      await store.saveThread(job, thread.id, { summary, summaryThrough: older.at(-1)!.createdAt });
      report.summarized = true;
    } catch (error) {
      logger.warn({ err: error, threadId: thread.id }, "Summarizing a chat failed");
    }
  }

  // Long-term memory
  const fresh = messages.filter(
    (row) => !thread.memoryThrough || row.createdAt > thread.memoryThrough,
  );
  if (settings.memoryEnabled && fresh.some((row) => row.role === "user")) {
    try {
      const existing = (await store.list(job)).map((row) => ({ id: row.id, content: row.content }));
      const seen = messages.slice(0, messages.length - fresh.length).slice(-CONTEXT_TURNS);
      const updates = await extractMemories(utility(), {
        existing,
        turns: [...seen, ...fresh].map(toTurn),
      });
      await store.apply(job, updates, thread.id);
      report.added = updates.add.length;
      report.updated = updates.update.length;
      report.removed = updates.remove.length;
    } catch (error) {
      logger.warn({ err: error, threadId: thread.id }, "Updating memories failed");
    }
  }
  if (messages.length)
    await store.saveThread(job, thread.id, { memoryThrough: messages.at(-1)!.createdAt });

  // Episodic memory
  try {
    if (!settings.chatSearchEnabled) {
      await episodes.remove(thread.id);
    } else if (messages.length) {
      const recent = messages
        .slice(-6)
        .map((row) => `${row.role}: ${row.content}`)
        .join("\n");
      const text = [thread.title ?? "", summary ?? "", recent]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, EPISODE_CHARACTERS);
      const [dense] = await ai.embeddings(context).embedDocuments([text]);
      await episodes.upsert({
        payload: {
          workspace_id: job.workspaceId,
          user_id: job.userId,
          thread_id: thread.id,
          title: thread.title ?? "Untitled chat",
          summary: text.slice(0, 800),
          updated_at: thread.updatedAt.toISOString(),
        },
        dense: dense!,
        sparse: sparseVector(text),
      });
      report.indexed = true;
    }
  } catch (error) {
    logger.warn({ err: error, threadId: thread.id }, "Indexing a chat for search failed");
  }
  return report;
}
