import type { stt, tts } from "@livekit/agents";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import { createGateway } from "ai";
import type { Env } from "../env";
import { GatewaySTT, STT_SAMPLE_RATE } from "./gateway-stt";
import { gatewayTTS } from "./gateway-tts";

export type SpeechProviderName = "elevenlabs" | "gateway";

export interface SpeechProviders {
  provider: SpeechProviderName;
  stt: stt.STT;
  tts: tts.TTS;
  /** Model IDs as the usage ledger records them. */
  sttModelId: string;
  ttsModelId: string;
  voiceId: string;
}

/**
 * Speech in and out. ElevenLabs directly when its key is set (the fastest
 * path, and the only one that can speak with a user's own voice); otherwise
 * the same kind of models through the AI gateway, with stock voices.
 */
export function createSpeechProviders(
  env: Pick<
    Env,
    | "ELEVENLABS_API_KEY"
    | "AI_GATEWAY_API_KEY"
    | "VOICE_GATEWAY_STT_MODEL"
    | "VOICE_GATEWAY_TTS_MODEL"
    | "VOICE_ELEVENLABS_TTS_MODEL"
    | "VOICE_DEFAULT_VOICE_ID"
  >,
  { voiceId = env.VOICE_DEFAULT_VOICE_ID }: { voiceId?: string | undefined } = {},
): SpeechProviders {
  if (env.ELEVENLABS_API_KEY) {
    return {
      provider: "elevenlabs",
      stt: new elevenlabs.STT({
        apiKey: env.ELEVENLABS_API_KEY,
        model: "scribe_v2_realtime",
        sampleRate: STT_SAMPLE_RATE,
      }),
      tts: new elevenlabs.TTS({
        apiKey: env.ELEVENLABS_API_KEY,
        voiceId,
        model: env.VOICE_ELEVENLABS_TTS_MODEL,
      }),
      sttModelId: "elevenlabs/scribe-v2-realtime",
      ttsModelId: `elevenlabs/${env.VOICE_ELEVENLABS_TTS_MODEL}`,
      voiceId,
    };
  }
  if (!env.AI_GATEWAY_API_KEY) {
    throw new Error("Voice needs ELEVENLABS_API_KEY or AI_GATEWAY_API_KEY for speech");
  }
  const gateway = createGateway({ apiKey: env.AI_GATEWAY_API_KEY });
  return {
    provider: "gateway",
    stt: new GatewaySTT({
      model: gateway.transcription(env.VOICE_GATEWAY_STT_MODEL),
      modelId: env.VOICE_GATEWAY_STT_MODEL,
    }),
    tts: gatewayTTS({
      model: gateway.speech(env.VOICE_GATEWAY_TTS_MODEL),
      modelId: env.VOICE_GATEWAY_TTS_MODEL,
      voiceId,
    }),
    sttModelId: env.VOICE_GATEWAY_STT_MODEL,
    ttsModelId: env.VOICE_GATEWAY_TTS_MODEL,
    voiceId,
  };
}
