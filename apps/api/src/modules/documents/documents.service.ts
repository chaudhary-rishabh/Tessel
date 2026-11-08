import { randomUUID } from "node:crypto";
import { sparseVector, type Ai, type VectorIndex } from "@tessel/ai";
import {
  documentMediaType,
  type CreateDocumentRequest,
  type CreateDocumentResponse,
  type DocumentSummary,
  type SearchRequest,
  type SearchResponse,
} from "@tessel/contracts";
import { searchRequestSchema } from "@tessel/contracts";
import { withUserContext, type Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import {
  objectCreatedEventBody,
  storageKeys,
  type ObjectStore,
  type UploadEventQueue,
} from "@tessel/storage";
import { AppError, errors } from "../../lib/errors";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import { documentsPolicy } from "./documents.policy";
import { documentsRepository, toDocument } from "./documents.repository";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId?: string;
}

export interface DocumentsServiceDependencies {
  db: Database;
  ai: Ai;
  objects: ObjectStore;
  uploads: UploadEventQueue;
  index: VectorIndex;
  /** "api" when the storage emulator can't send bucket notifications itself. */
  uploadEvents: "s3" | "api";
  logger: Logger;
}

export function createDocumentsService({
  db,
  ai,
  objects,
  uploads,
  index,
  uploadEvents,
  logger,
}: DocumentsServiceDependencies) {
  async function membership(
    tx: Parameters<Parameters<typeof withUserContext>[2]>[0],
    actor: Actor,
  ) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
    return workspace;
  }

  /** Puts a document on the ingestion queue, in the same shape S3 notifications use. */
  async function announce(storageKey: string, sizeBytes: number) {
    await uploads.send(
      objectCreatedEventBody({ bucket: objects.bucket, key: storageKey, size: sizeBytes }),
    );
  }

  return {
    async list(actor: Actor): Promise<DocumentSummary[]> {
      return withUserContext(db, actor.userId, async (tx) => {
        await membership(tx, actor);
        return (await documentsRepository.list(tx, actor.workspaceId)).map(toDocument);
      });
    },

    async get(actor: Actor, documentId: string): Promise<DocumentSummary> {
      return withUserContext(db, actor.userId, async (tx) => {
        const row = await documentsRepository.find(tx, actor.workspaceId, documentId);
        if (!row) throw errors.notFound("Document not found");
        return toDocument(row);
      });
    },

    /**
     * Registers an upload and returns a presigned URL for the browser to send
     * the file straight to storage. The signature fixes the key, size, and type.
     */
    async create(actor: Actor, request: CreateDocumentRequest): Promise<CreateDocumentResponse> {
      const id = randomUUID();
      const storageKey = storageKeys.documentOriginal(actor.workspaceId, id);
      const mediaType = documentMediaType(request.filename);
      const row = await withUserContext(db, actor.userId, async (tx) => {
        await membership(tx, actor);
        return documentsRepository.insert(tx, {
          id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          filename: request.filename,
          mediaType,
          sizeBytes: request.sizeBytes,
          storageKey,
        });
      });
      const upload = await objects.presignUpload(storageKey, {
        contentType: mediaType,
        contentLength: request.sizeBytes,
      });
      return { document: toDocument(row), upload };
    },

    /** Called by the browser after its upload finishes. Checks the file arrived, then queues it. */
    async complete(actor: Actor, documentId: string): Promise<DocumentSummary> {
      const row = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.find(tx, actor.workspaceId, documentId),
      );
      if (!row) throw errors.notFound("Document not found");
      if (row.status !== "uploading") return toDocument(row);

      const object = await objects.head(row.storageKey);
      if (!object) throw errors.conflict("upload_incomplete", "The file hasn't finished uploading");
      if (object.size !== row.sizeBytes) {
        throw errors.conflict(
          "upload_size_mismatch",
          "The uploaded file isn't the size that was announced",
        );
      }
      const queued = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.transition(tx, row.id, ["uploading"], "queued"),
      );
      if (uploadEvents === "api" && queued) await announce(row.storageKey, row.sizeBytes);
      return toDocument(queued ?? row);
    },

    async reprocess(actor: Actor, documentId: string): Promise<DocumentSummary> {
      const row = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const document = await documentsRepository.find(tx, actor.workspaceId, documentId);
        if (!document) throw errors.notFound("Document not found");
        if (!documentsPolicy.canManage(workspace.role, document.userId, actor.userId)) {
          throw errors.forbidden("Only the uploader, owners, and admins can do this");
        }
        const queued = await documentsRepository.transition(
          tx,
          document.id,
          ["failed", "ready"],
          "queued",
        );
        if (!queued)
          throw errors.conflict("document_busy", "This document is still being processed");
        return queued;
      });
      await announce(row.storageKey, row.sizeBytes);
      return toDocument(row);
    },

    async downloadUrl(actor: Actor, documentId: string): Promise<string> {
      const row = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.find(tx, actor.workspaceId, documentId),
      );
      if (!row || row.status === "uploading") throw errors.notFound("Document not found");
      return objects.presignDownload(row.storageKey, { filename: row.filename });
    },

    /** Removes the document everywhere: search index, storage, then the database row. */
    async remove(actor: Actor, documentId: string): Promise<void> {
      const row = await withUserContext(db, actor.userId, async (tx) => {
        const workspace = await membership(tx, actor);
        const document = await documentsRepository.find(tx, actor.workspaceId, documentId);
        if (!document) throw errors.notFound("Document not found");
        if (!documentsPolicy.canManage(workspace.role, document.userId, actor.userId)) {
          throw errors.forbidden("Only the uploader, owners, and admins can delete this document");
        }
        return document;
      });
      await index.deleteDocument(actor.workspaceId, row.id);
      await objects.deletePrefix(storageKeys.documentPrefix(actor.workspaceId, row.id));
      await withUserContext(db, actor.userId, (tx) => documentsRepository.remove(tx, row.id));
      logger.info({ documentId: row.id, workspaceId: actor.workspaceId }, "Document deleted");
    },

    /** Hybrid search (meaning and keywords) over the workspace's ready documents. */
    async search(actor: Actor, input: SearchRequest): Promise<SearchResponse> {
      const request = searchRequestSchema.parse(input);
      await withUserContext(db, actor.userId, (tx) => membership(tx, actor));
      if (!ai.isConfigured)
        throw new AppError(
          503,
          "ai_not_configured",
          "AI features are not configured on this server",
        );

      const embeddings = ai.embeddings({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        feature: "search",
        ...(actor.requestId ? { requestId: actor.requestId } : {}),
      });
      const dense = await embeddings.embedQuery(request.query);
      const hits = await index.search({
        workspaceId: actor.workspaceId,
        dense,
        sparse: sparseVector(request.query),
        limit: request.limit,
        ...(request.documentIds ? { documentIds: request.documentIds } : {}),
      });
      return {
        hits: hits.map((hit) => ({
          documentId: hit.payload.document_id,
          filename: hit.payload.filename,
          chunkIndex: hit.payload.chunk_index,
          page: hit.payload.page ?? null,
          text: hit.payload.text,
          score: hit.score,
        })),
      };
    },
  };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;
