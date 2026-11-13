import type { SpeechModel, TranscriptionModel } from "ai";
import { GatewaySTT } from "./gateway-stt";
import { gatewayTTS, TTS_SAMPLE_RATE } from "./gateway-tts";
import type { SpeechProviders } from "./providers";

/** What the mock "hears" once the user has spoken for a second. */
export const MOCK_TRANSCRIPT = "Hello from the test microphone";

/** Bytes in one second of 16-bit, 16 kHz mono audio. */
const ONE_SECOND = 16_000 * 2;

/**
 * Offline speech, for development and end-to-end tests: like the mock AI
 * gateway, it needs no keys and no network. After a second of audio it
 * "hears" MOCK_TRANSCRIPT, once per conversation, and it speaks every
 * sentence as a soft tone. It goes through the same gateway speech classes
 * as real speech, so everything after the model is the production path.
 */
export function createMockSpeech(voiceId = "mock"): SpeechProviders {
  const transcriber = {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock-stt",
    doGenerate: () => Promise.reject(new Error("The mock transcriber only streams")),
    doStream: async ({ audio }: { audio: ReadableStream<Uint8Array | string> }) => ({
      stream: new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          const reader = audio.getReader();
          let bytes = 0;
          let heard = false;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += typeof value === "string" ? 0 : value.byteLength;
            if (!heard && bytes >= ONE_SECOND) {
              heard = true;
              controller.enqueue({ type: "transcript-partial", text: "Hello from" });
              controller.enqueue({
                type: "transcript-final",
                text: MOCK_TRANSCRIPT,
                startSecond: 0,
                endSecond: 1,
              });
            }
          }
          controller.enqueue({ type: "finish", text: heard ? MOCK_TRANSCRIPT : "", segments: [] });
          controller.close();
        },
      }),
    }),
  } as unknown as TranscriptionModel;

  const speaker = {
    specificationVersion: "v4",
    provider: "mock",
    modelId: "mock-tts",
    doGenerate: () => Promise.reject(new Error("The mock speaker only streams")),
    doStream: async ({ text }: { text: ReadableStream<{ type: "text"; text: string }> }) => ({
      stream: new ReadableStream({
        async start(controller) {
          let said = "";
          const reader = text.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            said += value.text;
          }
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({
            type: "audio",
            audio: tone(Math.min(2.5, 0.2 + said.length * 0.04)),
            audioFormat: { type: "audio/pcm", rate: TTS_SAMPLE_RATE },
          });
          controller.enqueue({ type: "finish" });
          controller.close();
        },
      }),
    }),
  } as unknown as SpeechModel;

  return {
    provider: "gateway",
    stt: new GatewaySTT({ model: transcriber, modelId: "mock-stt" }),
    tts: gatewayTTS({ model: speaker, modelId: "mock-tts", voiceId }),
    sttModelId: "mock-stt",
    ttsModelId: "mock-tts",
    voiceId,
  };
}

/** A quiet 330 Hz tone with soft edges, as 16-bit PCM. */
function tone(seconds: number): Uint8Array {
  const samples = Math.round(TTS_SAMPLE_RATE * seconds);
  const pcm = new Int16Array(samples);
  const fade = TTS_SAMPLE_RATE * 0.02;
  for (let index = 0; index < samples; index += 1) {
    const edge = Math.min(1, index / fade, (samples - index) / fade);
    pcm[index] = Math.round(Math.sin((2 * Math.PI * 330 * index) / TTS_SAMPLE_RATE) * 4000 * edge);
  }
  return new Uint8Array(pcm.buffer);
}
