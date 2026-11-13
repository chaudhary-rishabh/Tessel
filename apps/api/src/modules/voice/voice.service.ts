import { AiNotConfiguredError, ModelNotFoundError, type Ai } from "@tessel/ai";
import { createVoiceSessionRequestSchema, type VoiceSession } from "@tessel/contracts";
import { users, voiceSessions, withUserContext, type Database, type Transaction } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { and, eq, inArray } from "drizzle-orm";
import { AppError, errors } from "../../lib/errors";
import { modelTier, type UsageLimits } from "../billing/usage-limits";
import { chatRepository } from "../chat/chat.repository";
import { workspacesRepository } from "../workspaces/workspaces.repository";
import type { VoiceRooms } from "./livekit";
import type { VoicesService } from "./voices.service";

export interface Actor {
  userId: string;
  workspaceId: string;
  requestId: string;
}

/** Sessions still holding a room. */
const OPEN_STATUSES = ["starting", "active"] as const;

const voiceUnavailable = () =>
  new AppError(503, "voice_unavailable", "Voice isn't set up on this server yet");

export function createVoiceService({
  db,
  ai,
  rooms,
  limits,
  voices,
  logger,
  maxSessionMinutes,
}: {
  db: Database;
  ai: Ai;
  /** Picks the voice each conversation speaks with; the default voice without it. */
  voices?: Pick<VoicesService, "voiceForSession"> | undefined;
  /** Without it, voice is off and every route answers 503 voice_unavailable. */
  rooms: VoiceRooms | undefined;
  limits?: UsageLimits | undefined;
  logger: Logger;
  maxSessionMinutes: number;
}) {
  async function requireMembership(tx: Transaction, actor: Actor) {
    const workspace = await workspacesRepository.findForUser(tx, actor.workspaceId, actor.userId);
    if (!workspace) throw errors.notFound("Workspace not found");
  }

  /** Ends rooms in the background; a room that can't be closed times out on its own. */
  function closeRooms(roomNames: string[]) {
    if (!rooms) return;
    for (const roomName of roomNames) {
      rooms
        .closeRoom(roomName)
        .catch((error: unknown) =>
          logger.warn({ err: error, roomName }, "Couldn't close a voice room"),
        );
    }
  }

  return {
    /** Whether the browser should offer voice at all. */
    status(): { available: boolean } {
      return { available: Boolean(rooms) && ai.isConfigured };
    },

    /**
     * Starts a voice conversation: checks the model, the plan's limits, and the
     * daily caps, creates (or continues) the chat, ends any conversation the
     * user still has open, and returns a token for the new room.
     */
    async start(actor: Actor, input: unknown): Promise<VoiceSession> {
      const request = createVoiceSessionRequestSchema.parse(input ?? {});
      if (!rooms) throw voiceUnavailable();
      if (!ai.isConfigured) throw new AiNotConfiguredError();

      const model = ai.registry.resolve(request.model, "voice");
      // A model named by the browser must be one the picker offers; the voice default needn't be.
      if (model.kind !== "chat" || (request.model && !model.selectable)) {
        throw new ModelNotFoundError(model.id);
      }

      if (limits) {
        await limits.check(
          { workspaceId: actor.workspaceId, userId: actor.userId, requestId: actor.requestId },
          modelTier(ai.registry, model.id),
        );
      }
      await ai.spend.assertWithinBudget({ workspaceId: actor.workspaceId, userId: actor.userId });

      const { session, userName, replaced } = await withUserContext(
        db,
        actor.userId,
        async (tx) => {
          await requireMembership(tx, actor);
          const thread = request.threadId
            ? await chatRepository.findThread(tx, { ...actor, threadId: request.threadId })
            : await chatRepository.createThread(tx, {
                workspaceId: actor.workspaceId,
                userId: actor.userId,
                modelId: model.id,
              });
          if (!thread) throw errors.notFound("Chat not found");

          // One conversation at a time: starting a new one ends the last.
          const open = await tx
            .update(voiceSessions)
            .set({ status: "ended", endReason: "replaced", endedAt: new Date() })
            .where(
              and(
                eq(voiceSessions.workspaceId, actor.workspaceId),
                eq(voiceSessions.userId, actor.userId),
                inArray(voiceSessions.status, [...OPEN_STATUSES]),
              ),
            )
            .returning({ roomName: voiceSessions.roomName });

          const voiceId = voices ? await voices.voiceForSession(tx, actor) : null;
          const id = crypto.randomUUID();
          const [row] = await tx
            .insert(voiceSessions)
            .values({
              id,
              workspaceId: actor.workspaceId,
              userId: actor.userId,
              threadId: thread.id,
              roomName: `voice-${id}`,
              modelId: model.id,
              voiceId,
            })
            .returning();
          const [user] = await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, actor.userId));
          return {
            session: row!,
            userName: user?.name ?? "",
            replaced: open.map((item) => item.roomName),
          };
        },
      );
      closeRooms(replaced);

      const token = await rooms.issueToken({
        roomName: session.roomName,
        userId: actor.userId,
        userName,
        dispatch: { voiceSessionId: session.id },
      });
      logger.info(
        { voiceSessionId: session.id, threadId: session.threadId, modelId: model.id },
        "Voice session started",
      );
      return {
        sessionId: session.id,
        threadId: session.threadId,
        url: rooms.publicUrl,
        token,
        modelId: model.id,
        maxDurationSeconds: maxSessionMinutes * 60,
      };
    },

    /** Ends a conversation from the browser's side (the agent also ends it when the room closes). */
    async end(actor: Actor, sessionId: string): Promise<void> {
      const ended = await withUserContext(db, actor.userId, async (tx) => {
        await requireMembership(tx, actor);
        const [row] = await tx
          .update(voiceSessions)
          .set({ status: "ended", endReason: "user_ended", endedAt: new Date() })
          .where(
            and(
              eq(voiceSessions.id, sessionId),
              eq(voiceSessions.workspaceId, actor.workspaceId),
              eq(voiceSessions.userId, actor.userId),
              inArray(voiceSessions.status, [...OPEN_STATUSES]),
            ),
          )
          .returning({ roomName: voiceSessions.roomName });
        if (row) return row;
        // Already ended is fine; a session that isn't theirs is not found.
        const [existing] = await tx
          .select({ id: voiceSessions.id })
          .from(voiceSessions)
          .where(
            and(
              eq(voiceSessions.id, sessionId),
              eq(voiceSessions.workspaceId, actor.workspaceId),
              eq(voiceSessions.userId, actor.userId),
            ),
          );
        if (!existing) throw errors.notFound("Voice session not found");
        return undefined;
      });
      if (ended) closeRooms([ended.roomName]);
    },
  };
}

export type VoiceService = ReturnType<typeof createVoiceService>;
