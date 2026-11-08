import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * Tessel as an OAuth authorization server for outside MCP clients (Claude,
 * Cursor, and others). Not tenant-scoped: the token endpoint runs before any
 * user context exists, like the auth tables.
 */

/** Clients that registered themselves (RFC 7591 dynamic registration). */
export const oauthClients = pgTable("oauth_clients", {
  /** The client_id. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * The full registration, sealed with ENCRYPTION_KEY: it includes the client
   * secret, which the SDK compares as given.
   */
  sealedInfo: text("sealed_info").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAuthorizationStatus = pgEnum("oauth_authorization_status", [
  "pending",
  "approved",
  "denied",
  "used",
]);

/** One sign-in from a client: waiting for consent, then a one-time code. */
export const oauthAuthorizations = pgTable("oauth_authorizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  state: text("state"),
  scopes: text("scopes").array().notNull(),
  resource: text("resource"),
  status: oauthAuthorizationStatus("status").notNull().default("pending"),
  /** Set on approval. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A client a user allowed into one workspace: its refresh token, and the access tokens it gets. */
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    /** The refresh token before the last rotation, to spot a copied one being reused. */
    previousRefreshTokenHash: text("previous_refresh_token_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_grants_user_idx").on(table.userId),
    index("oauth_grants_previous_refresh_idx").on(table.previousRefreshTokenHash),
  ],
);

export type OAuthGrantRow = typeof oauthGrants.$inferSelect;
export type OAuthAuthorizationRow = typeof oauthAuthorizations.$inferSelect;
