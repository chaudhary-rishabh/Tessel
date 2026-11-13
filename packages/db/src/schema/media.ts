import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { threads } from "./chat";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const mediaKind = pgEnum("media_kind", ["image", "video"]);
export const mediaStatus = pgEnum("media_status", ["pending", "ready", "failed"]);

/**
 * Images and videos a user generated, in chat or the gallery. Private to
 * the user who made them. The bytes live in S3 under the workspace's
 * prefix; images also keep a small WebP preview for the gallery.
 */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The chat it was made in; null when made in the gallery or the chat was deleted. */
    threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
    kind: mediaKind("kind").notNull(),
    status: mediaStatus("status").notNull().default("ready"),
    prompt: text("prompt").notNull(),
    modelId: text("model_id").notNull(),
    /** The images it was made from, for edits. */
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    mediaType: text("media_type"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    sizeBytes: integer("size_bytes"),
    storageKey: text("storage_key"),
    previewKey: text("preview_key"),
    /** For a background job: how far along it is, in percent. */
    progress: integer("progress_percent").notNull().default(0),
    error: text("error"),
    costNanoUsd: bigint("cost_nano_usd", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("media_owner_created_idx").on(table.userId, table.createdAt),
    index("media_thread_idx").on(table.threadId),
  ],
);

export type MediaRow = typeof media.$inferSelect;
