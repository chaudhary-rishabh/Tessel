import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A user's own voice, cloned with ElevenLabs from a recording they made and
 * verified by reading a one-time phrase. The recording itself isn't kept.
 * Row-level security limits each user to their own voices
 * (migration 0023_own_voices.sql).
 */
export const userVoices = pgTable(
  "user_voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("elevenlabs"),
    providerVoiceId: text("provider_voice_id").notNull(),
    name: text("name").notNull(),
    /** The phrase the user read to prove the voice was theirs, and when they agreed. */
    consentPhrase: text("consent_phrase").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_voices_user_idx").on(table.userId)],
);

export type UserVoiceRow = typeof userVoices.$inferSelect;
