import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const connectorAuth = pgEnum("connector_auth", ["none", "token", "oauth"]);
export const connectorStatus = pgEnum("connector_status", [
  "pending",
  "connected",
  "needs_auth",
  "error",
]);

/** A tool as the MCP server described it, cached when the connection is made or refreshed. */
export interface ConnectorToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

/**
 * One user's connection to an MCP server (GitHub, Notion, a custom URL) in a
 * workspace. Connections are private to the user who made them (RLS in
 * 0010_connectors.sql); credentials are encrypted before they're stored.
 */
export const connectorConnections = pgTable(
  "connector_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The catalog entry it came from, or null for a custom server. */
    catalogId: text("catalog_id"),
    name: text("name").notNull(),
    serverUrl: text("server_url").notNull(),
    auth: connectorAuth("auth").notNull(),
    /** Encrypted ConnectionCredentials (see @tessel/mcp). */
    credentials: text("credentials").notNull(),
    /** SHA-256 of the OAuth state while a sign-in is in progress. */
    oauthStateHash: text("oauth_state_hash"),
    oauthStateExpiresAt: timestamp("oauth_state_expires_at", { withTimezone: true }),
    status: connectorStatus("status").notNull().default("pending"),
    lastError: text("last_error"),
    tools: jsonb("tools").$type<ConnectorToolInfo[]>().notNull().default([]),
    /** Per-tool choices: auto, ask, allow, or off. */
    toolPolicies: jsonb("tool_policies")
      .$type<Record<string, "auto" | "ask" | "allow" | "off">>()
      .notNull()
      .default({}),
    enabled: boolean("enabled").notNull().default(true),
    /** What else the server offers besides tools: resources to read, and prompt templates. */
    extras: jsonb("extras")
      .$type<{
        resources?: boolean;
        prompts?: {
          name: string;
          title?: string;
          description?: string;
          arguments?: { name: string; description?: string; required?: boolean }[];
        }[];
      }>()
      .notNull()
      .default({}),
    /** Set up by an owner or admin for everyone in the workspace, with its credentials shared. */
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("connector_connections_owner_idx").on(table.workspaceId, table.userId)],
);

export type ConnectorConnectionRow = typeof connectorConnections.$inferSelect;
