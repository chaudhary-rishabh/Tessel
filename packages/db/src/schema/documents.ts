import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const documentStatus = pgEnum("document_status", [
  "uploading",
  "queued",
  "processing",
  "ready",
  "failed",
]);

/**
 * A file in a workspace's knowledge base. The original lives in S3 under
 * workspaces/{workspaceId}/documents/{id}/; its chunks live in Qdrant.
 * Documents are shared with the whole workspace (RLS in 0004_documents.sql).
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Who uploaded it. Ingestion runs as this user, so their spend caps apply. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    /** A big file's multipart upload, while its parts are arriving. */
    uploadId: text("upload_id"),
    status: documentStatus("status").notNull().default("uploading"),
    errorCode: text("error_code"),
    pageCount: integer("page_count"),
    chunkCount: integer("chunk_count"),
    characterCount: integer("character_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentStatus = (typeof documentStatus.enumValues)[number];
