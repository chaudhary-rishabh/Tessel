import {
  DEFAULT_API_CONNECT_OPTIONS,
  log,
  stt,
  type APIConnectOptions,
  type AudioBuffer,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { experimental_streamTranscribe as streamTranscribe, type TranscriptionModel } from "ai";

/** The sample rate the agent sends to speech to text; LiveKit resamples the room's audio to it. */
export const STT_SAMPLE_RATE = 16_000;

/** How often to report how much audio was transcribed, for usage and cost. */
const USAGE_REPORT_SECONDS = 5;

/** Consecutive failed connections before the stream gives up and the session reports an error. */
const MAX_RECONNECTS = 3;

export interface GatewaySTTOptions {
  /** The gateway transcription model, e.g. `elevenlabs/scribe-v2-realtime`. */
  model: TranscriptionModel;
  modelId: string;
  /** Spoken language hint; omitted lets the model detect it. */
  language?: string | undefined;
}

/**
 * Speech to text through the AI gateway's streaming transcription (the AI
 * SDK's `streamTranscribe`), so voice works with only the gateway key. Audio
 * goes up as 16 kHz PCM; partial transcripts come back as interim results and
 * committed ones as finals. Turn-taking itself comes from voice activity
 * detection and the turn detector, not from this stream.
 */
export class GatewaySTT extends stt.STT {
  label = "tessel.GatewaySTT";
  readonly #opts: GatewaySTTOptions;

  constructor(opts: GatewaySTTOptions) {
    super({ streaming: true, interimResults: true });
    this.#opts = opts;
  }

  override get model(): string {
    return this.#opts.modelId;
  }

  override get provider(): string {
    return "ai-gateway";
  }

  protected async _recognize(_frame: AudioBuffer): Promise<stt.SpeechEvent> {
    throw new Error("GatewaySTT only streams; use stream()");
  }

  stream(options: { connOptions?: APIConnectOptions } = {}): GatewaySpeechStream {
    return new GatewaySpeechStream(
      this,
      this.#opts,
      options.connOptions ?? DEFAULT_API_CONNECT_OPTIONS,
    );
  }
}

/** Little-endian 16-bit PCM bytes for one frame (frames already hold Int16 samples). */
function pcmBytes(frame: AudioFrame): Uint8Array {
  return new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
}

export class GatewaySpeechStream extends stt.SpeechStream {
  label = "tessel.GatewaySpeechStream";
  readonly #opts: GatewaySTTOptions;
  readonly #logger = log();
  #speaking = false;
  #unreportedSeconds = 0;

  constructor(owner: GatewaySTT, opts: GatewaySTTOptions, connOptions: APIConnectOptions) {
    super(owner, STT_SAMPLE_RATE, connOptions);
    this.#opts = opts;
  }

  #reportUsage(force = false) {
    if (this.#unreportedSeconds <= 0) return;
    if (!force && this.#unreportedSeconds < USAGE_REPORT_SECONDS) return;
    this.queue.put({
      type: stt.SpeechEventType.RECOGNITION_USAGE,
      recognitionUsage: { audioDuration: this.#unreportedSeconds },
    });
    this.#unreportedSeconds = 0;
  }

  #speechData(text: string, start = 0, end = 0): stt.SpeechData {
    return {
      language: (this.#opts.language ?? "") as stt.SpeechData["language"],
      text,
      startTime: start + this.startTimeOffset,
      endTime: end + this.startTimeOffset,
      confidence: 1,
    };
  }

  #startSpeech() {
    if (this.#speaking) return;
    this.#speaking = true;
    this.queue.put({ type: stt.SpeechEventType.START_OF_SPEECH });
  }

  /** The room's audio as a byte stream for the gateway, until the input ends or the session stops. */
  #audioStream(signal: AbortSignal): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (!signal.aborted) {
          const next = await this.input.next();
          if (next.done) {
            controller.close();
            return;
          }
          // A flush marks the end of an utterance; the gateway keeps one stream open, so skip it.
          if (next.value === GatewaySpeechStream.FLUSH_SENTINEL) continue;
          const frame = next.value as AudioFrame;
          this.#unreportedSeconds += frame.samplesPerChannel / frame.sampleRate;
          this.#reportUsage();
          controller.enqueue(pcmBytes(frame));
          return;
        }
        controller.close();
      },
    });
  }

  protected async run(): Promise<void> {
    let failures = 0;
    while (!this.closed && !this.input.closed) {
      const attempt = new AbortController();
      const stop = () => attempt.abort();
      this.abortSignal.addEventListener("abort", stop, { once: true });
      try {
        const result = streamTranscribe({
          model: this.#opts.model,
          audio: this.#audioStream(attempt.signal),
          inputAudioFormat: { type: "audio/pcm", rate: STT_SAMPLE_RATE },
          abortSignal: attempt.signal,
        });
        // Partial text since the last committed transcript.
        let partial = "";
        for await (const part of result.fullStream) {
          failures = 0;
          if (part.type === "transcript-delta") {
            partial += part.delta;
            if (!partial.trim()) continue;
            this.#startSpeech();
            this.queue.put({
              type: stt.SpeechEventType.INTERIM_TRANSCRIPT,
              alternatives: [this.#speechData(partial)],
            });
          } else if (part.type === "transcript-partial") {
            partial = part.text;
            if (!partial.trim()) continue;
            this.#startSpeech();
            this.queue.put({
              type: stt.SpeechEventType.INTERIM_TRANSCRIPT,
              alternatives: [
                this.#speechData(
                  partial,
                  part.startSecond,
                  (part.startSecond ?? 0) + (part.durationInSeconds ?? 0),
                ),
              ],
            });
          } else if (part.type === "transcript-final") {
            partial = "";
            const text = part.text.trim();
            if (text) {
              this.#startSpeech();
              this.queue.put({
                type: stt.SpeechEventType.FINAL_TRANSCRIPT,
                alternatives: [this.#speechData(text, part.startSecond, part.endSecond)],
              });
            }
            if (this.#speaking) {
              this.#speaking = false;
              this.queue.put({ type: stt.SpeechEventType.END_OF_SPEECH });
            }
          } else if (part.type === "error") {
            throw part.error;
          }
        }
        // The audio ended (the session is closing): nothing more to transcribe.
        break;
      } catch (error) {
        if (this.closed || this.abortSignal.aborted) break;
        failures += 1;
        this.#logger.warn({ err: error, failures }, "Gateway transcription failed; reconnecting");
        if (failures > MAX_RECONNECTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * failures));
      } finally {
        this.abortSignal.removeEventListener("abort", stop);
        attempt.abort();
      }
    }
    this.#reportUsage(true);
  }
}
