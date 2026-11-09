import { documents, withUserContext, type Database, type DocumentRow } from "@tessel/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Document status changes made by the worker. Upload events carry only the
 * object key, so the uploader is looked up first and every change then runs
 * as that user, under the same row-level security as the API.
 */
export function createDocumentStore(db: Database) {
  return {
    async uploaderOf(documentId: string): Promise<string | null> {
      const result = await db.execute<{ user_id: string | null }>(
        sql`select app.document_uploader(${documentId}::uuid) as user_id`,
      );
      return result.rows[0]?.user_id ?? null;
    },

    /** Marks the document as processing and returns it, or undefined if it no longer exists. */
    /** Marks the document processing, only if it's in the job's workspace. */
    async start(
      userId: string,
      workspaceId: string,
      documentId: string,
    ): Promise<DocumentRow | undefined> {
      return withUserContext(db, userId, async (tx) => {
        const [row] = await tx
          .update(documents)
          .set({ status: "processing", errorCode: null })
          .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
          .returning();
        return row;
      });
    },

    async finish(
      userId: string,
      documentId: string,
      values: { pageCount: number | null; chunkCount: number; characterCount: number },
    ): Promise<boolean> {
      return withUserContext(db, userId, async (tx) => {
        const rows = await tx
          .update(documents)
          .set({ status: "ready", errorCode: null, processedAt: new Date(), ...values })
          .where(eq(documents.id, documentId))
          .returning({ id: documents.id });
        return rows.length > 0;
      });
    },

    async fail(userId: string, documentId: string, errorCode: string): Promise<void> {
      await withUserContext(db, userId, (tx) =>
        tx
          .update(documents)
          .set({ status: "failed", errorCode, processedAt: new Date() })
          .where(eq(documents.id, documentId)),
      );
    },
  };
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;
