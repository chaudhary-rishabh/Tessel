import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The model registry as edited in the admin app: one row holding the whole
 * config (defaults and models), validated by @tessel/ai before it's saved and
 * again when it's loaded. Without a row, the bundled models.json is used.
 */
export const aiModelConfig = pgTable(
  "ai_model_config",
  {
    id: integer("id").primaryKey().default(1),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("ai_model_config_single_row", sql`${table.id} = 1`)],
);
