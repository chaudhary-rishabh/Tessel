import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

/** How the agent may use a tool in a workspace, set by its owners and admins. */
export type WorkspaceToolPolicy = "ask" | "allow" | "block";

/**
 * Workspace-wide rules owners and admins set: which tools always need
 * approval, never do, or are off; which connectors are blocked; which
 * built-in skills are turned off. Members can read them.
 */
export const workspacePolicies = pgTable("workspace_policies", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  toolPolicies: jsonb("tool_policies")
    .$type<Record<string, WorkspaceToolPolicy>>()
    .notNull()
    .default({}),
  /** Connector catalog IDs (or names, for custom servers) nobody in the workspace may use. */
  blockedConnectors: jsonb("blocked_connectors").$type<string[]>().notNull().default([]),
  /** Built-in skill names turned off for the workspace. */
  disabledSkills: jsonb("disabled_skills").$type<string[]>().notNull().default([]),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type WorkspacePoliciesRow = typeof workspacePolicies.$inferSelect;
