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

/** What this server offers: voice conversations (LiveKit), replies read aloud, and dictation. */
export const voiceStatusSchema = z.object({
  available: z.boolean(),
  readAloud: z.boolean().default(false),
  dictation: z.boolean().default(false),
});
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

/** RPC the browser calls on the agent to stop it mid-sentence (tapping the voice visual). */
export const VOICE_INTERRUPT_RPC = "tessel.interrupt";

/**
 * Voices Tessel can speak with, from ElevenLabs' default voices (available
 * directly and through the AI gateway). The first is the default.
 */
export const STOCK_VOICES = [
  { providerId: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", description: "Friendly and clear" },
  { providerId: "cjVigY5qzO86Huf0OWal", name: "Eric", description: "Friendly, American" },
  { providerId: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", description: "Warm, British" },
  { providerId: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Deep and calm" },
  { providerId: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "Expressive, American" },
  { providerId: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Warm, British" },
] as const;

export const DEFAULT_VOICE_ID = `stock:${STOCK_VOICES[0].providerId}`;

/** A voice choice: "stock:<provider voice ID>" or "own:<the user's voice ID>". */
export const voiceIdSchema = z.string().regex(/^(stock:[A-Za-z0-9]{8,40}|own:[0-9a-f-]{36})$/);

export const voiceOptionSchema = z.object({
  id: voiceIdSchema,
  kind: z.enum(["stock", "own"]),
  name: z.string(),
  description: z.string(),
  createdAt: z.iso.datetime().optional(),
});
export type VoiceOption = z.infer<typeof voiceOptionSchema>;

export const voiceListSchema = z.object({
  voices: z.array(voiceOptionSchema),
  selectedId: voiceIdSchema,
  /** Whether the user can add their own voice here, and if not, why. */
  ownVoice: z.object({
    available: z.boolean(),
    reason: z.enum(["plan", "not_configured"]).optional(),
  }),
});
export type VoiceList = z.infer<typeof voiceListSchema>;

export const selectVoiceRequestSchema = z.object({ voiceId: voiceIdSchema });
export type SelectVoiceRequest = z.infer<typeof selectVoiceRequestSchema>;

/** What the user reads aloud to add their voice; the token proves which phrase was asked for. */
export const voiceChallengeSchema = z.object({
  token: z.string(),
  passage: z.string(),
  phrase: z.string(),
  minSeconds: z.number().int().positive(),
  maxSeconds: z.number().int().positive(),
});
export type VoiceChallenge = z.infer<typeof voiceChallengeSchema>;

export const ownVoiceParamsSchema = z.object({
  workspaceId: z.uuid(),
  voiceId: z.uuid(),
});

export const voicePreviewParamsSchema = z.object({
  workspaceId: z.uuid(),
  voiceId: voiceIdSchema,
});
