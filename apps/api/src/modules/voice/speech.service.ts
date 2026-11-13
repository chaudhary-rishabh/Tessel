import { AiNotConfiguredError, usdToNano, type Ai } from "@tessel/ai";
import { withUserContext, type Database } from "@tessel/db";
import type { Logger } from "@tessel/logger";
import { z } from "zod";
import { AppError, errors } from "../../lib/errors";
import { chatRepository } from "../chat/chat.repository";
import type { Actor } from "./voice.service";
import type { VoicesService } from "./voices.service";

/** The most a reply read aloud says: about three minutes of speech. */
export const READ_ALOUD_MAX_CHARACTERS = 2_500;
/** The longest dictation: two minutes is plenty for one message. */
export const DICTATION_MAX_SECONDS = 120;

export interface SpeechRates {
  sttUsdPerMinute: number;
  ttsUsdPer1kChars: number;
}

export const speakRequestSchema = z.object({ messageId: z.uuid() });

/**
 * A reply as it should sound: no markdown, code and tables described rather
 * than read symbol by symbol, links as their text, and cut at a sentence once
 * it gets long.
 */
export function speakableText(markdown: string, max = READ_ALOUD_MAX_CHARACTERS): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " There's a code block here. ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\d+\]/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/https?:\/\/\S+/g, "a link")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${cut.slice(0, end > max * 0.5 ? end + 1 : max).trim()} That's the start of it; the rest is in the chat.`;
}

/**
 * Speech outside a voice conversation: a reply read aloud in the user's
 * voice, and a recording turned into text for the composer. Both count
 * toward the daily spend caps and land in the usage ledger.
 */
export function createSpeechService({
  db,
  ai,
  voices,
  speak,
  transcribe,
  rates,
  logger,
}: {
  db: Database;
  ai: Ai;
  voices: Pick<VoicesService, "voiceForSession">;
  speak: ((providerVoiceId: string, text: string) => Promise<Buffer>) | undefined;
  transcribe:
    ((audio: Buffer, mediaType: string) => Promise<{ text: string; seconds: number }>) | undefined;
  rates: SpeechRates;
  logger: Logger;
}) {
  const record = (
    actor: Actor,
    event: { modelId: string; costNanoUsd: number; latencyMs: number; status?: "ok" | "error" },
  ) =>
    ai.tracker.record({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      requestId: actor.requestId,
      feature: "voice",
      route: "gateway",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimated: false,
      errorCode: null,
      status: event.status ?? "ok",
      modelId: event.modelId,
      costNanoUsd: event.costNanoUsd,
      latencyMs: event.latencyMs,
    });

  return {
    available(): { readAloud: boolean; dictation: boolean } {
      return { readAloud: Boolean(speak), dictation: Boolean(transcribe) };
    },

    /** One of the user's replies, read aloud in their chosen voice, as MP3. */
    async readAloud(actor: Actor, input: unknown): Promise<Buffer> {
      const { messageId } = speakRequestSchema.parse(input);
      if (!speak) throw new AppError(503, "read_aloud_unavailable", "Reading aloud isn't set up");
      await ai.spend.assertWithinBudget(actor);
      const { content, voiceId } = await withUserContext(db, actor.userId, async (tx) => {
        const message = await chatRepository.findMessage(tx, messageId);
        if (!message || message.workspaceId !== actor.workspaceId || message.role !== "assistant")
          throw errors.notFound("Message not found");
        return { content: message.content, voiceId: await voices.voiceForSession(tx, actor) };
      });
      const text = speakableText(content);
      if (!text) throw errors.badRequest("nothing_to_read", "This reply has nothing to read.");

      const startedAt = Date.now();
      try {
        const audio = await speak(voiceId, text);
        await record(actor, {
          modelId: "elevenlabs/eleven-flash-v2.5",
          costNanoUsd: usdToNano((text.length / 1000) * rates.ttsUsdPer1kChars),
          latencyMs: Date.now() - startedAt,
        });
        return audio;
      } catch (error) {
        logger.error({ err: error }, "Couldn't read a reply aloud");
        throw new AppError(
          502,
          "voice_provider_error",
          "This reply couldn't be read aloud. Try again.",
        );
      }
    },

    /** Turns a short recording into text for the composer. */
    async dictate(actor: Actor, audio: Buffer, mediaType: string): Promise<{ text: string }> {
      if (!transcribe) throw new AiNotConfiguredError();
      await ai.spend.assertWithinBudget(actor);
      const startedAt = Date.now();
      let heard: { text: string; seconds: number };
      try {
        heard = await transcribe(audio, mediaType);
      } catch (error) {
        logger.error({ err: error }, "Couldn't transcribe dictation");
        throw new AppError(
          502,
          "voice_provider_error",
          "Your recording couldn't be turned into text.",
        );
      }
      await record(actor, {
        modelId: "elevenlabs/scribe-v2",
        costNanoUsd: usdToNano((heard.seconds / 60) * rates.sttUsdPerMinute),
        latencyMs: Date.now() - startedAt,
      });
      if (heard.seconds > DICTATION_MAX_SECONDS + 5) {
        logger.warn({ seconds: heard.seconds }, "Dictation longer than the limit");
      }
      return { text: heard.text.trim() };
    },
  };
}

export type SpeechService = ReturnType<typeof createSpeechService>;
