import {
  messages,
  threads,
  users,
  voiceSessions,
  voiceTurns,
  withUserContext,
  type Database,
  type Transaction,
} from "@tessel/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { percentile, type TurnTimings } from "./latency";

/** Who a voice session belongs to, and the chat it writes to. Everything else acts as this user. */
export interface VoiceSessionContext {
  id: string;
  workspaceId: string;
  userId: string;
  threadId: string;
  modelId: string;
  /** The provider voice the API picked for this conversation; null for the default. */
  voiceId: string | null;
  userName: string;
}

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Earlier messages the agent hears when a chat continues by voice. */
const HISTORY_MESSAGES = 20;
const TITLE_CHARACTERS = 60;

/** A first title from what the user said; the chat page can rename it. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_CHARACTERS) return clean;
  const cut = clean.slice(0, TITLE_CHARACTERS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:!?-]+$/, "")}…`;
}

const OPEN = ["starting", "active"] as const;

/**
 * The agent's database access. It starts from the session ID alone (from the
 * room token the API signed), looks up the owner, and from then on acts as
 * that user, so row-level security keeps it to their own chats.
 */
export function createVoiceStore(db: Database) {
  const asUser = <T>(session: VoiceSessionContext, work: (tx: Transaction) => Promise<T>) =>
    withUserContext(db, session.userId, work);

  return {
    /** The open session, with the chat's recent messages; undefined if it ended or never existed. */
    async open(
      sessionId: string,
    ): Promise<{ session: VoiceSessionContext; history: HistoryMessage[] } | undefined> {
      const owners = await db.execute<{ user_id: string; workspace_id: string }>(
        sql`select user_id, workspace_id from app.voice_session_owner(${sessionId})`,
      );
      const owner = owners.rows[0];
      if (!owner) return undefined;

      return withUserContext(db, owner.user_id, async (tx) => {
        const [row] = await tx
          .select({
            id: voiceSessions.id,
            workspaceId: voiceSessions.workspaceId,
            userId: voiceSessions.userId,
            threadId: voiceSessions.threadId,
            modelId: voiceSessions.modelId,
            voiceId: voiceSessions.voiceId,
            userName: users.name,
          })
          .from(voiceSessions)
          .innerJoin(users, eq(users.id, voiceSessions.userId))
          .where(and(eq(voiceSessions.id, sessionId), inArray(voiceSessions.status, [...OPEN])));
        if (!row) return undefined;

        const recent = await tx
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(and(eq(messages.threadId, row.threadId), eq(messages.status, "complete")))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(HISTORY_MESSAGES);
        return {
          session: row,
          history: recent.reverse().filter((message) => message.content.trim().length > 0),
        };
      });
    },

    /** The agent joined: the conversation is live. */
    markActive(
      session: VoiceSessionContext,
      details: { speechProvider: string; voiceId: string },
    ): Promise<void> {
      return asUser(session, async (tx) => {
        await tx
          .update(voiceSessions)
          .set({ status: "active", startedAt: new Date(), ...details })
          .where(and(eq(voiceSessions.id, session.id), eq(voiceSessions.status, "starting")));
      });
    },

    /**
     * Saves one spoken message to the chat. The first thing the user says
     * names a chat that has no title yet.
     */
    addMessage(
      session: VoiceSessionContext,
      message: { role: "user" | "assistant"; content: string; modelId?: string | undefined },
    ): Promise<void> {
      return asUser(session, async (tx) => {
        await tx.insert(messages).values({
          threadId: session.threadId,
          workspaceId: session.workspaceId,
          userId: session.userId,
          role: message.role,
          content: message.content,
          status: "complete",
          modelId: message.role === "assistant" ? (message.modelId ?? session.modelId) : null,
          voiceSessionId: session.id,
        });
        await tx
          .update(threads)
          .set({ updatedAt: new Date(), modelId: session.modelId })
          .where(eq(threads.id, session.threadId));
        if (message.role === "user") {
          await tx
            .update(threads)
            .set({ title: titleFrom(message.content) })
            .where(and(eq(threads.id, session.threadId), isNull(threads.title)));
        }
      });
    },

    /** One reply's timings, and the turn count. */
    addTurn(
      session: VoiceSessionContext,
      timings: TurnTimings,
      interrupted: boolean,
    ): Promise<void> {
      return asUser(session, async (tx) => {
        await tx.insert(voiceTurns).values({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          userId: session.userId,
          endOfTurnMs: timings.endOfTurnMs,
          modelFirstTokenMs: timings.modelFirstTokenMs,
          firstAudioMs: timings.firstAudioMs,
          totalMs: timings.totalMs,
          preemptive: timings.preemptive,
          interrupted,
        });
        await tx
          .update(voiceSessions)
          .set({ turns: sql`${voiceSessions.turns} + 1` })
          .where(eq(voiceSessions.id, session.id));
      });
    },

    /** Adds transcribed speech time. */
    addUserAudio(session: VoiceSessionContext, audioMs: number): Promise<void> {
      if (audioMs <= 0) return Promise.resolve();
      return asUser(session, async (tx) => {
        await tx
          .update(voiceSessions)
          .set({ userAudioMs: sql`${voiceSessions.userAudioMs} + ${Math.round(audioMs)}` })
          .where(eq(voiceSessions.id, session.id));
      });
    },

    /**
     * Closes the session with its latency summary. A session the browser or a
     * newer session already ended keeps that reason.
     */
    finish(
      session: VoiceSessionContext,
      outcome: { status: "ended" | "failed"; endReason: string },
    ): Promise<void> {
      return asUser(session, async (tx) => {
        const turns = await tx
          .select({ totalMs: voiceTurns.totalMs })
          .from(voiceTurns)
          .where(eq(voiceTurns.sessionId, session.id))
          .orderBy(asc(voiceTurns.createdAt));
        const totals = turns.map((turn) => turn.totalMs);
        await tx
          .update(voiceSessions)
          .set({
            latencyP50Ms: percentile(totals, 50) ?? null,
            latencyP95Ms: percentile(totals, 95) ?? null,
            status: sql`case when ${voiceSessions.status} in ('starting', 'active') then ${outcome.status}::voice_session_status else ${voiceSessions.status} end`,
            endReason: sql`coalesce(${voiceSessions.endReason}, ${outcome.endReason})`,
            endedAt: sql`coalesce(${voiceSessions.endedAt}, now())`,
          })
          .where(eq(voiceSessions.id, session.id));
      });
    },
  };
}

export type VoiceStore = ReturnType<typeof createVoiceStore>;
