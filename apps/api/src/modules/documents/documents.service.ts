import { randomUUID } from "node:crypto";
import { sparseVector, type Ai, type VectorIndex } from "@tessel/ai";
import {
  documentMediaType,
  MULTIPART_THRESHOLD_BYTES,
  uploadPartsRequestSchema,
  type CreateDocumentRequest,
  type UploadedPartsResponse,
  type CreateDocumentResponse,
  type DocumentSummary,
  type DocumentTextResponse,
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
import { noAudit, type AuditRecorder } from "../../lib/audit";
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
  /** Removes a deleted document's part of the knowledge graph. */
  graph?: { forgetDocument(workspaceId: string, documentId: string): Promise<void> };
  audit?: AuditRecorder;
  /** Files over `thresholdBytes` go up in parts of `partBytes` (at least 5 MB, S3's minimum). */
  multipart?: { thresholdBytes: number; partBytes: number };
}

const DEFAULT_PART_BYTES = 16 * 1024 * 1024;

export function createDocumentsService({
  db,
  ai,
  objects,
  uploads,
  index,
  uploadEvents,
  logger,
  graph,
  audit = noAudit,
  multipart = { thresholdBytes: MULTIPART_THRESHOLD_BYTES, partBytes: DEFAULT_PART_BYTES },
}: DocumentsServiceDependencies) {
  const partCount = (sizeBytes: number) => Math.ceil(sizeBytes / multipart.partBytes);

  /** The uploader's document while its parts are arriving. */
  async function uploadingInParts(actor: Actor, documentId: string) {
    const row = await withUserContext(db, actor.userId, (tx) =>
      documentsRepository.find(tx, actor.workspaceId, documentId),
    );
    if (!row || row.userId !== actor.userId) throw errors.notFound("Document not found");
    if (row.status !== "uploading" || !row.uploadId) {
      throw errors.conflict("not_uploading_in_parts", "This file isn't being uploaded in parts");
    }
    return row as typeof row & { uploadId: string };
  }

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
      const inParts = request.sizeBytes > multipart.thresholdBytes;
      await withUserContext(db, actor.userId, (tx) => membership(tx, actor));
      const uploadId = inParts
        ? (await objects.createMultipart(storageKey, mediaType)).uploadId
        : undefined;
      const row = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.insert(tx, {
          id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          filename: request.filename,
          mediaType,
          sizeBytes: request.sizeBytes,
          storageKey,
          ...(uploadId ? { uploadId } : {}),
        }),
      );
      if (inParts) {
        return {
          document: toDocument(row),
          upload: null,
          multipart: { partSize: multipart.partBytes, partCount: partCount(request.sizeBytes) },
        };
      }
      const upload = await objects.presignUpload(storageKey, {
        contentType: mediaType,
        contentLength: request.sizeBytes,
      });
      return { document: toDocument(row), upload, multipart: null };
    },

    /** Presigned URLs for some of a big file's parts. */
    async presignParts(
      actor: Actor,
      documentId: string,
      input: unknown,
    ): Promise<{ parts: { partNumber: number; url: string }[] }> {
      const { partNumbers } = uploadPartsRequestSchema.parse(input);
      const row = await uploadingInParts(actor, documentId);
      const count = partCount(row.sizeBytes);
      if (partNumbers.some((number) => number > count)) {
        throw errors.badRequest("invalid_part", `This file has ${count} parts`);
      }
      return {
        parts: await Promise.all(
          partNumbers.map(async (partNumber) => ({
            partNumber,
            url: await objects.presignPart(row.storageKey, row.uploadId, partNumber),
          })),
        ),
      };
    },

    /** The parts already uploaded, so an interrupted upload can carry on. */
    async uploadedParts(actor: Actor, documentId: string): Promise<UploadedPartsResponse> {
      const row = await uploadingInParts(actor, documentId);
      const parts = await objects.listParts(row.storageKey, row.uploadId);
      return {
        partSize: multipart.partBytes,
        partCount: partCount(row.sizeBytes),
        uploaded: parts.map(({ partNumber, size }) => ({ partNumber, size })),
      };
    },

    /**
     * Saves text as a new document (used by the agent's create_document
     * tool) and queues it for indexing like an upload.
     */
    async createFromText(actor: Actor, filename: string, text: string): Promise<DocumentSummary> {
      const id = randomUUID();
      const storageKey = storageKeys.documentOriginal(actor.workspaceId, id);
      const mediaType = documentMediaType(filename);
      const body = Buffer.from(text, "utf8");
      await withUserContext(db, actor.userId, async (tx) => {
        await membership(tx, actor);
        await documentsRepository.insert(tx, {
          id,
          workspaceId: actor.workspaceId,
          userId: actor.userId,
          filename,
          mediaType,
          sizeBytes: body.length,
          storageKey,
        });
      });
      await objects.put(storageKey, body, mediaType);
      const queued = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.transition(tx, id, ["uploading"], "queued"),
      );
      // In AWS the put above already raised an S3 event.
      if (uploadEvents === "api") await announce(storageKey, body.length);
      if (!queued) throw new Error("Document disappeared while it was being created");
      return toDocument(queued);
    },

    /** Called by the browser after its upload finishes. Checks the file arrived, then queues it. */
    async complete(actor: Actor, documentId: string): Promise<DocumentSummary> {
      const row = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.find(tx, actor.workspaceId, documentId),
      );
      if (!row) throw errors.notFound("Document not found");
      if (row.status !== "uploading") return toDocument(row);

      if (row.uploadId) {
        // Join the parts, once every one of them is there.
        const parts = await objects.listParts(row.storageKey, row.uploadId);
        const size = parts.reduce((total, part) => total + part.size, 0);
        if (parts.length !== partCount(row.sizeBytes) || size !== row.sizeBytes) {
          throw errors.conflict("upload_incomplete", "Some parts of the file haven't uploaded yet");
        }
        await objects.completeMultipart(row.storageKey, row.uploadId, parts);
        await withUserContext(db, actor.userId, (tx) =>
          documentsRepository.clearUploadId(tx, row.id),
        );
      }

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

    /** The document's extracted text, for clients that read documents (e.g. over MCP). */
    async text(
      actor: Actor,
      documentId: string,
      maxCharacters: number,
    ): Promise<DocumentTextResponse> {
      const row = await withUserContext(db, actor.userId, (tx) =>
        documentsRepository.find(tx, actor.workspaceId, documentId),
      );
      if (!row) throw errors.notFound("Document not found");
      if (row.status !== "ready") {
        throw errors.conflict(
          "document_not_ready",
          "This document is still being processed, or failed",
        );
      }
      const text = (
        await objects.get(storageKeys.documentText(actor.workspaceId, row.id))
      ).toString("utf8");
      return {
        documentId: row.id,
        filename: row.filename,
        text: text.slice(0, maxCharacters),
        truncated: text.length > maxCharacters,
        characterCount: text.length,
      };
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
      if (row.uploadId) {
        await objects.abortMultipart(row.storageKey, row.uploadId).catch((error: unknown) => {
          logger.warn({ err: error, documentId: row.id }, "Couldn't cancel a multipart upload");
        });
      }
      await index.deleteDocument(actor.workspaceId, row.id);
      await graph
        ?.forgetDocument(actor.workspaceId, row.id)
        .catch((error: unknown) =>
          logger.warn(
            { err: error, documentId: row.id },
            "Couldn't remove a document from the graph",
          ),
        );
      await objects.deletePrefix(storageKeys.documentPrefix(actor.workspaceId, row.id));
      await withUserContext(db, actor.userId, (tx) => documentsRepository.remove(tx, row.id));
      logger.info({ documentId: row.id, workspaceId: actor.workspaceId }, "Document deleted");
      await audit.record({
        actorId: actor.userId,
        workspaceId: actor.workspaceId,
        action: "document.deleted",
        target: `document:${row.id}`,
        metadata: { filename: row.filename },
      });
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
