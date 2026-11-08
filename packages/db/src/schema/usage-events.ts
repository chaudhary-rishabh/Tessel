import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const usageStatus = pgEnum("usage_status", ["ok", "error", "aborted", "blocked"]);
export const usageRoute = pgEnum("usage_route", ["gateway", "direct"]);

/**
 * The usage ledger: one row per model call, written by @tessel/ai for every
 * call, whether it succeeded, failed, was stopped, or was blocked. Append-only:
 * the app role may insert and read rows but never change or delete them
 * (see migration 0002_usage_ledger.sql).
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    /** What the call was for: chat, moderation, embedding, and so on. */
    feature: text("feature").notNull(),
    modelId: text("model_id").notNull(),
    route: usageRoute("route").notNull(),
    status: usageStatus("status").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    /** Billionths of a US dollar. */
    costNanoUsd: bigint("cost_nano_usd", { mode: "number" }).notNull().default(0),
    /** True when tokens were estimated because the call failed or was stopped. */
    estimated: boolean("estimated").notNull().default(false),
    latencyMs: integer("latency_ms").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_events_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    index("usage_events_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("usage_events_request_idx")
      .on(table.requestId)
      .where(sql`${table.requestId} is not null`),
  ],
);

export type UsageEventRow = typeof usageEvents.$inferSelect;
export type NewUsageEventRow = typeof usageEvents.$inferInsert;
