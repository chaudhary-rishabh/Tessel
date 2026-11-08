import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { threads } from "./chat";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const memorySource = pgEnum("memory_source", ["chat", "user", "tool"]);

/**
 * Long-term memory: short facts about a user that Tessel keeps across chats
 * in one workspace (their role, projects, preferences). Private to the user,
 * who can see, edit, and delete every one (RLS in 0012_memory.sql).
 */
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** chat: noticed after a reply; tool: the agent was asked to remember; user: typed in Settings. */
    source: memorySource("source").notNull(),
    sourceThreadId: uuid("source_thread_id").references(() => threads.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("memories_owner_idx").on(table.userId, table.workspaceId, table.updatedAt)],
);

/** Whether Tessel remembers things and searches past chats, per user and workspace. */
export const memorySettings = pgTable(
  "memory_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memoryEnabled: boolean("memory_enabled").notNull().default(true),
    chatSearchEnabled: boolean("chat_search_enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.userId, table.workspaceId] })],
);

export type MemoryRow = typeof memories.$inferSelect;
export type MemorySettingsRow = typeof memorySettings.$inferSelect;
