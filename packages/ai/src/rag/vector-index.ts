import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { SparseVector } from "./sparse";

/** What every stored chunk carries. workspace_id is on every point and every query. */
export interface ChunkPayload {
  workspace_id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  filename: string;
  page?: number;
}

export interface IndexedChunk {
  payload: ChunkPayload;
  dense: number[];
  sparse: SparseVector;
}

export interface SearchHit {
  score: number;
  payload: ChunkPayload;
}

export interface HybridQuery {
  workspaceId: string;
  dense: number[];
  sparse: SparseVector;
  limit: number;
  documentIds?: string[];
}

/** Chunk storage and hybrid search, scoped to one workspace per call. */
export interface VectorIndex {
  ensureCollection(): Promise<void>;
  upsert(chunks: IndexedChunk[]): Promise<void>;
  deleteDocument(workspaceId: string, documentId: string): Promise<void>;
  /** Dense and keyword results fused with reciprocal rank fusion. */
  search(query: HybridQuery): Promise<SearchHit[]>;
  ping(): Promise<void>;
}

/** A stable UUID per chunk, so re-indexing a document overwrites its points. */
export function chunkPointId(documentId: string, chunkIndex: number): string {
  const hex = createHash("sha256").update(`${documentId}:${chunkIndex}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const workspaceFilter = (workspaceId: string, documentIds?: string[]) => ({
  must: [
    { key: "workspace_id", match: { value: workspaceId } },
    ...(documentIds?.length ? [{ key: "document_id", match: { any: documentIds } }] : []),
  ],
});

const UPSERT_BATCH = 64;
const PREFETCH_LIMIT = 40;

export function createQdrantIndex({
  url,
  apiKey,
  collection,
  dimensions,
}: {
  url: string;
  apiKey?: string;
  collection: string;
  dimensions: number;
}): VectorIndex {
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
      // Tenant index: Qdrant co-locates each workspace's points, keeping filtered search fast.
      await client.createPayloadIndex(collection, {
        field_name: "workspace_id",
        field_schema: { type: "keyword", is_tenant: true },
        wait: true,
      });
      await client.createPayloadIndex(collection, {
        field_name: "document_id",
        field_schema: "keyword",
        wait: true,
      });
    },

    async upsert(chunks) {
      for (let start = 0; start < chunks.length; start += UPSERT_BATCH) {
        await client.upsert(collection, {
          wait: true,
          points: chunks.slice(start, start + UPSERT_BATCH).map((chunk) => ({
            id: chunkPointId(chunk.payload.document_id, chunk.payload.chunk_index),
            vector: { dense: chunk.dense, sparse: chunk.sparse },
            payload: { ...chunk.payload },
          })),
        });
      }
    },

    async deleteDocument(workspaceId, documentId) {
      await client.delete(collection, {
        wait: true,
        filter: workspaceFilter(workspaceId, [documentId]),
      });
    },

    async search({ workspaceId, dense, sparse, limit, documentIds }) {
      const filter = workspaceFilter(workspaceId, documentIds);
      const result = await client.query(collection, {
        prefetch: [
          { query: dense, using: "dense", limit: PREFETCH_LIMIT, filter },
          ...(sparse.indices.length > 0
            ? [{ query: sparse, using: "sparse", limit: PREFETCH_LIMIT, filter }]
            : []),
        ],
        query: { fusion: "rrf" },
        filter,
        limit,
        with_payload: true,
      });
      return result.points.map((point) => ({
        score: point.score,
        payload: point.payload as unknown as ChunkPayload,
      }));
    },

    async ping() {
      await client.collectionExists(collection);
    },
  };
}

/** Hybrid search in memory, for tests: cosine plus keyword overlap, fused by rank. */
export function memoryVectorIndex(): VectorIndex & { points: Map<string, IndexedChunk> } {
  const points = new Map<string, IndexedChunk>();
  const cosine = (a: number[], b: number[]) => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i]! * b[i]!;
      na += a[i]! ** 2;
      nb += b[i]! ** 2;
    }
    return na && nb ? dot / Math.sqrt(na * nb) : 0;
  };
  const overlap = (a: SparseVector, b: SparseVector) => {
    const set = new Set(a.indices);
    return b.indices.reduce((total, index, i) => total + (set.has(index) ? b.values[i]! : 0), 0);
  };
  return {
    points,
    ensureCollection: async () => undefined,
    upsert: async (chunks) => {
      for (const chunk of chunks)
        points.set(chunkPointId(chunk.payload.document_id, chunk.payload.chunk_index), chunk);
    },
    deleteDocument: async (workspaceId, documentId) => {
      for (const [id, chunk] of points) {
        if (chunk.payload.workspace_id === workspaceId && chunk.payload.document_id === documentId)
          points.delete(id);
      }
    },
    search: async ({ workspaceId, dense, sparse, limit, documentIds }) => {
      const candidates = [...points.values()].filter(
        (chunk) =>
          chunk.payload.workspace_id === workspaceId &&
          (!documentIds?.length || documentIds.includes(chunk.payload.document_id)),
      );
      const rank = (score: (chunk: IndexedChunk) => number) =>
        new Map(
          [...candidates]
            .sort((a, b) => score(b) - score(a))
            .map((chunk, position) => [chunk, position] as const),
        );
      const denseRank = rank((chunk) => cosine(chunk.dense, dense));
      const sparseRank = rank((chunk) => overlap(chunk.sparse, sparse));
      return candidates
        .map((chunk) => ({
          score:
            1 / (60 + denseRank.get(chunk)!) +
            (overlap(chunk.sparse, sparse) > 0 ? 1 / (60 + sparseRank.get(chunk)!) : 0),
          payload: chunk.payload,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
    ping: async () => undefined,
  };
}
