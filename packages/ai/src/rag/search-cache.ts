import { cacheKeyHash, type CacheStats, type KeyValueCache } from "../cache";
import type { SearchHit, VectorIndex } from "./vector-index";

/** How long a search result is reused when nothing in the workspace changed. */
const SEARCH_CACHE_TTL_SECONDS = 10 * 60;

const versionKey = (workspaceId: string) => `search-version:${workspaceId}`;

/**
 * Caches hybrid search results per workspace. Each workspace has a version
 * that every change to its index (indexing, re-indexing, deleting) bumps,
 * and result keys include it, so a change makes every older result
 * unreachable at once; they expire on their own.
 */
export function withSearchCache(
  index: VectorIndex,
  cache: KeyValueCache,
  { ttlSeconds = SEARCH_CACHE_TTL_SECONDS } = {},
): VectorIndex & { stats: CacheStats } {
  const stats: CacheStats = { hits: 0, misses: 0 };
  const bump = (workspaceIds: Iterable<string>) =>
    Promise.all([...new Set(workspaceIds)].map((id) => cache.incr(versionKey(id))));

  return {
    stats,
    ensureCollection: () => index.ensureCollection(),
    ping: () => index.ping(),
    async upsert(chunks) {
      await index.upsert(chunks);
      await bump(chunks.map((chunk) => chunk.payload.workspace_id));
    },
    async deleteDocument(workspaceId, documentId) {
      await index.deleteDocument(workspaceId, documentId);
      await bump([workspaceId]);
    },
    async search(query) {
      const version = (await cache.get(versionKey(query.workspaceId))) ?? "0";
      const key = `search:${query.workspaceId}:${version}:${cacheKeyHash(
        JSON.stringify([query.dense, query.sparse, query.limit, query.documentIds ?? null]),
      )}`;
      const cached = await cache.get(key);
      if (cached) {
        stats.hits += 1;
        return JSON.parse(cached) as SearchHit[];
      }
      stats.misses += 1;
      const hits = await index.search(query);
      await cache.set(key, JSON.stringify(hits), ttlSeconds);
      return hits;
    },
  };
}
