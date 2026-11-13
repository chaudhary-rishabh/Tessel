import { z } from "zod";

/** Treats `KEY=` in an env file the same as a missing key. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

/** AI settings shared by every service that calls models. Spread into a service's env schema. */
export const aiEnvShape = {
  /** Vercel AI Gateway key. Without it (and without a fallback key) AI features are off. */
  AI_GATEWAY_API_KEY: optional(z.string().min(1)),
  AI_GATEWAY_URL: z.url().default("https://ai-gateway.vercel.sh/v1"),
  /** The gateway's AI SDK endpoint, for image and video models. */
  AI_GATEWAY_SDK_URL: z.url().default("https://ai-gateway.vercel.sh/v3/ai"),
  /** The image model for generating and editing images. */
  AI_IMAGE_MODEL: z.string().min(1).default("openai/gpt-image-2"),
  /**
   * What an image costs when the gateway doesn't say: US dollars per million
   * input and output tokens, or per image for models without token usage.
   */
  AI_IMAGE_INPUT_USD_PER_M: z.coerce.number().nonnegative().default(5),
  AI_IMAGE_OUTPUT_USD_PER_M: z.coerce.number().nonnegative().default(30),
  AI_IMAGE_USD_PER_IMAGE: z.coerce.number().nonnegative().default(0.05),
  /** The video model, and what a second of video costs (with sound, at 720p), for the ledger. */
  AI_VIDEO_MODEL: z.string().min(1).default("google/veo-3.1-fast-generate-001"),
  AI_VIDEO_USD_PER_SECOND: z.coerce.number().nonnegative().default(0.15),
  /** The model that transcribes uploaded recordings, and its price per minute for the ledger. */
  AI_TRANSCRIPTION_MODEL: z.string().min(1).default("elevenlabs/scribe-v2"),
  AI_TRANSCRIPTION_USD_PER_MINUTE: z.coerce.number().nonnegative().default(0.0037),
  /** Emergency fallback straight to OpenAI when the gateway is down. */
  AI_FALLBACK_OPENAI_API_KEY: optional(z.string().min(1)),
  AI_FALLBACK_OPENAI_URL: optional(z.url()),
  /** Emergency fallback straight to Anthropic when the gateway is down. */
  AI_FALLBACK_ANTHROPIC_API_KEY: optional(z.string().min(1)),
  AI_FALLBACK_ANTHROPIC_URL: optional(z.url()),
  /** A models.json to use instead of the one built into the image. */
  AI_MODELS_FILE: optional(z.string().min(1)),
  AI_MODERATION: z.enum(["model", "off"]).default("model"),
  /** What happens to a message when the moderation check itself fails. */
  AI_MODERATION_ON_FAILURE: z.enum(["allow", "block"]).default("allow"),
  /** Daily spend caps in US dollars. 0 turns a cap off. */
  AI_DAILY_LIMIT_USER_USD: z.coerce.number().nonnegative().default(5),
  AI_DAILY_LIMIT_WORKSPACE_USD: z.coerce.number().nonnegative().default(50),
  AI_DAILY_LIMIT_GLOBAL_USD: z.coerce.number().nonnegative().default(500),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
};

export const aiEnvSchema = z.object(aiEnvShape);
export type AiEnv = z.infer<typeof aiEnvSchema>;

/** Daily spend caps from the AI environment variables. */
export const spendLimitsFromEnv = (env: AiEnv) => ({
  userDailyUsd: env.AI_DAILY_LIMIT_USER_USD,
  workspaceDailyUsd: env.AI_DAILY_LIMIT_WORKSPACE_USD,
  globalDailyUsd: env.AI_DAILY_LIMIT_GLOBAL_USD,
});
