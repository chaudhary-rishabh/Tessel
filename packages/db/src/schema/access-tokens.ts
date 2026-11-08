import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * Personal access tokens: let outside tools (MCP clients, scripts) act as a
 * user in one workspace, with limited scopes. Only a SHA-256 hash of the token
 * is kept; the token itself is shown once. Private to the owner (RLS in
 * 0011_access_tokens.sql).
 */
export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** The first characters, to tell tokens apart, e.g. "tsl_pat_3fK9". */
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("personal_access_tokens_owner_idx").on(table.userId, table.workspaceId)],
);

export type PersonalAccessTokenRow = typeof personalAccessTokens.$inferSelect;
