import { aiEnvShape } from "@tessel/ai";
import { STOCK_VOICES } from "@tessel/contracts";
import { loadEnvFiles, logLevelSchema, nodeEnvSchema, parseEnv } from "@tessel/config/env";
import { z } from "zod";

const optional = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

export const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    /** The LiveKit server the agent registers with (ws://livekit:7880 on the host). */
    LIVEKIT_URL: z.url(),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    /** Restricted app role; row-level security applies to the agent too. */
    DATABASE_URL: z.url(),
    /** Spend cap counters, shared with the API and worker. */
    REDIS_CACHE_URL: z.url(),
    /** Memory jobs after a conversation, picked up by the worker. */
    REDIS_QUEUE_URL: z.url(),

    /**
     * ElevenLabs, for speech to text, text to speech, and the user's own voices.
     * Without it, speech goes through the AI gateway with stock voices.
     */
    ELEVENLABS_API_KEY: optional,
    /** Speech to text through the gateway, when there is no ElevenLabs key. */
    VOICE_GATEWAY_STT_MODEL: z.string().min(1).default("elevenlabs/scribe-v2-realtime"),
    /** Text to speech through the gateway, when there is no ElevenLabs key. */
    VOICE_GATEWAY_TTS_MODEL: z.string().min(1).default("elevenlabs/eleven-flash-v2.5"),
    /**
     * "mock" uses scripted offline speech (development and end-to-end tests);
     * never in production.
     */
    VOICE_SPEECH_PROVIDER: z.enum(["auto", "mock"]).default("auto"),
    /** ElevenLabs text-to-speech model when calling ElevenLabs directly. */
    VOICE_ELEVENLABS_TTS_MODEL: z.string().min(1).default("eleven_flash_v2_5"),
    /** The voice the agent speaks with unless the user picked another. */
    VOICE_DEFAULT_VOICE_ID: z.string().min(1).default(STOCK_VOICES[0].providerId),

    /** The shortest pause, after speech, that can end a turn. Lower is snappier but cuts in more. */
    VOICE_ENDPOINTING_MIN_MS: z.coerce.number().int().nonnegative().default(250),
    /** The longest the agent waits for more when the user seems mid-sentence. */
    VOICE_ENDPOINTING_MAX_MS: z.coerce.number().int().positive().default(2500),
    /** Silence the voice activity detector needs before it reports the end of speech. */
    VOICE_VAD_SILENCE_MS: z.coerce.number().int().positive().default(300),
    /** The longest one conversation can run. Matches the API's setting. */
    VOICE_MAX_SESSION_MINUTES: z.coerce.number().int().positive().default(30),
    /** Warm job processes kept ready, so a new conversation doesn't wait for one to start. */
    VOICE_IDLE_PROCESSES: z.coerce.number().int().nonnegative().default(2),
    /** Calls this agent takes at once before LiveKit sends new ones elsewhere (or refuses them). */
    VOICE_MAX_CONCURRENT_CALLS: z.coerce.number().int().positive().default(8),
    /** Health check port for the agent server. */
    VOICE_HEALTH_PORT: z.coerce.number().int().positive().default(4700),

    /** US dollars per minute of speech to text, for the usage ledger. */
    VOICE_STT_USD_PER_MINUTE: z.coerce.number().nonnegative().default(0.0037),
    /** US dollars per thousand characters of text to speech, for the usage ledger. */
    VOICE_TTS_USD_PER_1K_CHARS: z.coerce.number().nonnegative().default(0.04),
    ...aiEnvShape,
  })
  .refine((env) => !(env.NODE_ENV === "production" && env.VOICE_SPEECH_PROVIDER === "mock"), {
    path: ["VOICE_SPEECH_PROVIDER"],
    message: "The mock speech provider can't run in production",
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Reads and checks the environment, with a clear message for anything
 * missing. In development, `.env` (here or at the repo root) fills the gaps.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env) loadEnvFiles();
  return parseEnv(envSchema, source);
}
