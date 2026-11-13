import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * Instructions a workspace wrote for one kind of work, which the agent loads
 * when a request matches. Shared with the whole workspace; the author, owners,
 * and admins can change them (RLS in 0009_skills.sql).
 */
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Who wrote it. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** kebab-case, what the agent calls it. */
    name: text("name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    instructions: text("instructions").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("skills_workspace_name_idx").on(table.workspaceId, table.name),
    index("skills_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export type SkillRow = typeof skills.$inferSelect;

/**
 * Reference files and templates a skill brings with it, which the agent
 * reads when the skill's instructions call for them. Text only.
 */
export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Like "templates/report.md". */
    path: text("path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("skill_files_skill_path_idx").on(table.skillId, table.path)],
);

export type SkillFileRow = typeof skillFiles.$inferSelect;
