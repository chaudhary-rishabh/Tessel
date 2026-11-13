import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { threads } from "./chat";
import { users } from "./users";
import { workspaces } from "./workspaces";

export const voiceSessionStatus = pgEnum("voice_session_status", [
  "starting",
  "active",
  "ended",
  "failed",
]);

/**
 * One voice conversation: a LiveKit room the API issued a token for, and the
 * chat its transcript is written to. Private to its owner, like the chat.
 */
export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** The LiveKit room, unique per session. */
    roomName: text("room_name").notNull().unique(),
    modelId: text("model_id").notNull(),
    /** Which speech provider the agent used: `elevenlabs` or `gateway`. */
    speechProvider: text("speech_provider"),
    /** The voice the agent spoke with. */
    voiceId: text("voice_id"),
    status: voiceSessionStatus("status").notNull().default("starting"),
    /** Why it ended: `user_left`, `time_limit`, `spend_limit`, `error`, and so on. */
    endReason: text("end_reason"),
    /** Completed turns (a user turn and the agent's reply). */
    turns: integer("turns").notNull().default(0),
    /** How much of the user's speech was transcribed, in milliseconds. */
    userAudioMs: integer("user_audio_ms").notNull().default(0),
    /** Median and 95th-percentile time from the end of the user's speech to the first audio. */
    latencyP50Ms: integer("latency_p50_ms"),
    latencyP95Ms: integer("latency_p95_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the agent joined and the conversation could start. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("voice_sessions_owner_recent_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt.desc(),
    ),
    index("voice_sessions_thread_idx").on(table.threadId),
  ],
);

/**
 * How fast one reply started, split by stage. The sum is what the user feels:
 * the gap between the end of their speech and the first sound of the reply.
 */
export const voiceTurns = pgTable(
  "voice_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => voiceSessions.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** From the end of speech until the turn was declared over (turn detection and transcript). */
    endOfTurnMs: integer("end_of_turn_ms").notNull(),
    /** From the request to the model's first token. Overlaps end of turn when generation started early. */
    modelFirstTokenMs: integer("model_first_token_ms").notNull(),
    /** From the first text sent to speech until the first audio came back. */
    firstAudioMs: integer("first_audio_ms").notNull(),
    /** End of speech to first audio, as the user hears it. */
    totalMs: integer("total_ms").notNull(),
    /** Whether the reply was drafted before the turn ended. */
    preemptive: boolean("preemptive").notNull().default(false),
    interrupted: boolean("interrupted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("voice_turns_session_idx").on(table.sessionId),
    index("voice_turns_recent_idx").on(table.createdAt.desc()),
  ],
);

export type VoiceSessionRow = typeof voiceSessions.$inferSelect;
export type VoiceTurnRow = typeof voiceTurns.$inferSelect;
export type VoiceSessionStatus = (typeof voiceSessionStatus.enumValues)[number];
