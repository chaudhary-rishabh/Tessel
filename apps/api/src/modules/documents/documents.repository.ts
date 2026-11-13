import type { DocumentSummary } from "@tessel/contracts";
import { documents, type DocumentRow, type DocumentStatus, type Transaction } from "@tessel/db";
import { and, desc, eq, inArray } from "drizzle-orm";

export function toDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    filename: row.filename,
    mediaType: row.mediaType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    errorCode: row.errorCode,
    pageCount: row.pageCount,
    chunkCount: row.chunkCount,
    uploadedBy: row.userId,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

/** Runs inside withUserContext; row-level security also limits every query to the caller's workspaces. */
export const documentsRepository = {
  list(tx: Transaction, workspaceId: string): Promise<DocumentRow[]> {
    return tx
      .select()
      .from(documents)
      .where(eq(documents.workspaceId, workspaceId))
      .orderBy(desc(documents.createdAt));
  },

  async find(
    tx: Transaction,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentRow | undefined> {
    const [row] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)));
    return row;
  },

  async findMany(tx: Transaction, workspaceId: string, ids: string[]): Promise<DocumentRow[]> {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(documents)
      .where(and(eq(documents.workspaceId, workspaceId), inArray(documents.id, ids)));
  },

  async insert(
    tx: Transaction,
    values: Pick<
      DocumentRow,
      "id" | "workspaceId" | "userId" | "filename" | "mediaType" | "sizeBytes" | "storageKey"
    > &
      Partial<Pick<DocumentRow, "uploadId">>,
  ): Promise<DocumentRow> {
    const [row] = await tx.insert(documents).values(values).returning();
    if (!row) throw new Error("Failed to insert document");
    return row;
  },

  /** Moves a document to `status`, only from one of `from`. Returns the row if it moved. */
  async transition(
    tx: Transaction,
    documentId: string,
    from: DocumentStatus[],
    status: DocumentStatus,
  ): Promise<DocumentRow | undefined> {
    const [row] = await tx
      .update(documents)
      .set({ status, errorCode: null })
      .where(and(eq(documents.id, documentId), inArray(documents.status, from)))
      .returning();
    return row;
  },

  async clearUploadId(tx: Transaction, documentId: string): Promise<void> {
    await tx.update(documents).set({ uploadId: null }).where(eq(documents.id, documentId));
  },

  async remove(tx: Transaction, documentId: string): Promise<boolean> {
    const rows = await tx
      .delete(documents)
      .where(eq(documents.id, documentId))
      .returning({ id: documents.id });
    return rows.length > 0;
  },
};
