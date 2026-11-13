import { describe, expect, it } from "vitest";
import { createSpeechProviders } from "./providers";

const env = {
  AI_GATEWAY_API_KEY: "gateway-key",
  VOICE_GATEWAY_STT_MODEL: "elevenlabs/scribe-v2-realtime",
  VOICE_GATEWAY_TTS_MODEL: "elevenlabs/eleven-flash-v2.5",
  VOICE_ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5",
  VOICE_DEFAULT_VOICE_ID: "XrExE9yKIg1WjnnlVkGX",
};

describe("speech providers", () => {
  it("uses ElevenLabs directly when its key is set", () => {
    const speech = createSpeechProviders({ ...env, ELEVENLABS_API_KEY: "eleven-key" });
    expect(speech).toMatchObject({
      provider: "elevenlabs",
      voiceId: "XrExE9yKIg1WjnnlVkGX",
      sttModelId: "elevenlabs/scribe-v2-realtime",
      ttsModelId: "elevenlabs/eleven_flash_v2_5",
    });
    expect(speech.stt.capabilities.streaming).toBe(true);
  });

  it("falls back to the AI gateway, which streams speech too", () => {
    const speech = createSpeechProviders(
      { ...env, ELEVENLABS_API_KEY: undefined },
      { voiceId: "cjVigY5qzO86Huf0OWal" },
    );
    expect(speech).toMatchObject({ provider: "gateway", voiceId: "cjVigY5qzO86Huf0OWal" });
    expect(speech.stt.capabilities.streaming).toBe(true);
    // Sentence by sentence: the adapter makes the gateway's speech a streaming TTS.
    expect(speech.tts.capabilities.streaming).toBe(true);
  });

  it("speaks a user's own voice only with ElevenLabs", () => {
    expect(
      createSpeechProviders({ ...env, ELEVENLABS_API_KEY: "key" }, { voiceId: "own-cloned-id" })
        .voiceId,
    ).toBe("own-cloned-id");
    // Through the gateway it can't, so the default voice speaks instead.
    expect(
      createSpeechProviders({ ...env, ELEVENLABS_API_KEY: undefined }, { voiceId: "own-cloned-id" })
        .voiceId,
    ).toBe("XrExE9yKIg1WjnnlVkGX");
  });

  it("needs one of the two keys", () => {
    expect(() =>
      createSpeechProviders({
        ...env,
        ELEVENLABS_API_KEY: undefined,
        AI_GATEWAY_API_KEY: undefined,
      }),
    ).toThrow(/ELEVENLABS_API_KEY or AI_GATEWAY_API_KEY/);
  });
});
