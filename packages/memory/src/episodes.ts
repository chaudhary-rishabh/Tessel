import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { SparseVector } from "@tessel/ai";

/**
 * Episodic memory: one point per chat, holding what it was about, so later
 * chats can find earlier ones by meaning. Every query is scoped to one user
 * in one workspace.
 */
export interface EpisodePayload {
  workspace_id: string;
  user_id: string;
  thread_id: string;
  title: string;
  /** What the chat covered, as indexed. */
  summary: string;
  updated_at: string;
}

export interface IndexedEpisode {
  payload: EpisodePayload;
  dense: number[];
  sparse: SparseVector;
}

export interface EpisodeHit {
  score: number;
  payload: EpisodePayload;
}

export interface EpisodeIndex {
  ensureCollection(): Promise<void>;
  upsert(episode: IndexedEpisode): Promise<void>;
  remove(threadId: string): Promise<void>;
  /** Removes every episode of a user in a workspace, e.g. when they turn chat search off. */
  removeAll(workspaceId: string, userId: string): Promise<void>;
  search(query: {
    workspaceId: string;
    userId: string;
    dense: number[];
    sparse: SparseVector;
    limit: number;
    excludeThreadId?: string;
  }): Promise<EpisodeHit[]>;
  ping(): Promise<void>;
}

/** Qdrant point IDs are UUIDs; a thread's ID already is one, but hashing keeps IDs opaque. */
const pointId = (threadId: string) => {
  const hex = createHash("sha256").update(`episode:${threadId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const ownerFilter = (workspaceId: string, userId: string, excludeThreadId?: string) => ({
  must: [
    { key: "workspace_id", match: { value: workspaceId } },
    { key: "user_id", match: { value: userId } },
  ],
  ...(excludeThreadId
    ? { must_not: [{ key: "thread_id", match: { value: excludeThreadId } }] }
    : {}),
});

export function createQdrantEpisodeIndex({
  url,
  apiKey,
  collection,
  dimensions,
}: {
  url: string;
  apiKey?: string;
  collection: string;
  dimensions: number;
}): EpisodeIndex {
  const client = new QdrantClient({
    url,
    ...(apiKey ? { apiKey } : {}),
    checkCompatibility: false,
  });
  return {
    async ensureCollection() {
      const { exists } = await client.collectionExists(collection);
      if (!exists) {
        await client.createCollection(collection, {
          vectors: { dense: { size: dimensions, distance: "Cosine" } },
          sparse_vectors: { sparse: { modifier: "idf" } },
        });
      }
      await client.createPayloadIndex(collection, {
        field_name: "workspace_id",
        field_schema: { type: "keyword", is_tenant: true },
        wait: true,
      });
      for (const field of ["user_id", "thread_id"]) {
        await client.createPayloadIndex(collection, {
          field_name: field,
          field_schema: "keyword",
          wait: true,
        });
      }
    },
    async upsert({ payload, dense, sparse }) {
      await client.upsert(collection, {
        wait: true,
        points: [
          { id: pointId(payload.thread_id), vector: { dense, sparse }, payload: { ...payload } },
        ],
      });
    },
    async remove(threadId) {
      await client.delete(collection, { wait: true, points: [pointId(threadId)] });
    },
    async removeAll(workspaceId, userId) {
      await client.delete(collection, { wait: true, filter: ownerFilter(workspaceId, userId) });
    },
    async search({ workspaceId, userId, dense, sparse, limit, excludeThreadId }) {
      const filter = ownerFilter(workspaceId, userId, excludeThreadId);
      const result = await client.query(collection, {
        prefetch: [
          { query: dense, using: "dense", limit: 30, filter },
          ...(sparse.indices.length ? [{ query: sparse, using: "sparse", limit: 30, filter }] : []),
        ],
        query: { fusion: "rrf" },
        filter,
        limit,
        with_payload: true,
      });
      return result.points.map((point) => ({
        score: point.score,
        payload: point.payload as unknown as EpisodePayload,
      }));
    },
    async ping() {
      await client.collectionExists(collection);
    },
  };
}

/** Episodes in memory, for tests: keyword overlap first, then recency. */
export function memoryEpisodeIndex(): EpisodeIndex & { episodes: Map<string, IndexedEpisode> } {
  const episodes = new Map<string, IndexedEpisode>();
  const overlap = (a: SparseVector, b: SparseVector) => {
    const set = new Set(a.indices);
    return b.indices.reduce((total, index, i) => total + (set.has(index) ? b.values[i]! : 0), 0);
  };
  return {
    episodes,
    ensureCollection: async () => undefined,
    upsert: async (episode) => {
      episodes.set(episode.payload.thread_id, episode);
    },
    remove: async (threadId) => {
      episodes.delete(threadId);
    },
    removeAll: async (workspaceId, userId) => {
      for (const [id, episode] of episodes) {
        if (episode.payload.workspace_id === workspaceId && episode.payload.user_id === userId)
          episodes.delete(id);
      }
    },
    search: async ({ workspaceId, userId, sparse, limit, excludeThreadId }) =>
      [...episodes.values()]
        .filter(
          ({ payload }) =>
            payload.workspace_id === workspaceId &&
            payload.user_id === userId &&
            payload.thread_id !== excludeThreadId,
        )
        .map((episode) => ({ score: overlap(episode.sparse, sparse), payload: episode.payload }))
        .filter((hit) => hit.score > 0)
        .sort(
          (a, b) => b.score - a.score || b.payload.updated_at.localeCompare(a.payload.updated_at),
        )
        .slice(0, limit),
    ping: async () => undefined,
  };
}
