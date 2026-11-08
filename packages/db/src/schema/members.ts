import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaceRole, workspaces } from "./workspaces";

/**
 * Invitations to a team workspace, sent by email. Only a hash of the link's
 * token is kept. Owners and admins manage them (RLS in 0017); accepting goes
 * through app.accept_invitation, since the invitee isn't a member yet.
 */
export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Trimmed and lowercased; only the account with this email can accept. */
    email: text("email").notNull(),
    role: workspaceRole("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("workspace_invitations_workspace_idx").on(table.workspaceId)],
);

/**
 * Who did what: security changes, membership, tokens, and admin actions.
 * Written by the API only; read by platform admins, and by workspace owners
 * and admins for their own workspace. Kept when the actor or workspace goes.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    /** Like "member.invited" or "auth.two_factor_enabled". */
    action: text("action").notNull(),
    /** What it was done to, like "user:<id>" or "token:<id>". */
    target: text("target"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_workspace_idx").on(table.workspaceId, table.createdAt),
    index("audit_events_actor_idx").on(table.actorId, table.createdAt),
    index("audit_events_created_idx").on(table.createdAt),
  ],
);

export type WorkspaceInvitationRow = typeof workspaceInvitations.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
