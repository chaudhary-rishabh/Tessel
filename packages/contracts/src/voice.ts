import { z } from "zod";

/** Starts a voice conversation, in a new chat or continuing one. */
export const createVoiceSessionRequestSchema = z.object({
  /** Continue this chat by voice. Omitted starts a new chat. */
  threadId: z.uuid().optional(),
  /** A chat model from the picker. Omitted uses the registry's voice model. */
  model: z.string().min(1).optional(),
});
export type CreateVoiceSessionRequest = z.infer<typeof createVoiceSessionRequestSchema>;

export const voiceSessionParamsSchema = z.object({
  workspaceId: z.uuid(),
  sessionId: z.uuid(),
});

/** Whether this server offers voice (LiveKit and a model provider are set up). */
export const voiceStatusSchema = z.object({ available: z.boolean() });
export type VoiceStatus = z.infer<typeof voiceStatusSchema>;

/** Everything the browser needs to join the conversation. */
export const voiceSessionSchema = z.object({
  sessionId: z.uuid(),
  threadId: z.uuid(),
  /** The LiveKit server's WebSocket address. */
  url: z.string(),
  /** A room token for this one conversation, valid for a few minutes to join. */
  token: z.string(),
  modelId: z.string(),
  /** The longest the conversation can run before the agent ends it. */
  maxDurationSeconds: z.number().int().positive(),
});
export type VoiceSession = z.infer<typeof voiceSessionSchema>;

/** Shared between the API (which writes it into the room token) and the voice agent. */
export const voiceDispatchMetadataSchema = z.object({
  voiceSessionId: z.uuid(),
});
export type VoiceDispatchMetadata = z.infer<typeof voiceDispatchMetadataSchema>;

/** The LiveKit agent name the API dispatches and the voice agent registers as. */
export const VOICE_AGENT_NAME = "tessel-voice";
