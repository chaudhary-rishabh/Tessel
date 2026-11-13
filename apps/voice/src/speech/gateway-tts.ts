import {
  AudioByteStream,
  DEFAULT_API_CONNECT_OPTIONS,
  shortuuid,
  tokenize,
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import { experimental_streamSpeech as streamSpeech, type SpeechModel } from "ai";

/** Speech comes back as 24 kHz mono 16-bit PCM, LiveKit's native frame format. */
export const TTS_SAMPLE_RATE = 24_000;
const CHANNELS = 1;

export interface GatewayTTSOptions {
  /** The gateway speech model, e.g. `elevenlabs/eleven-flash-v2.5`. */
  model: SpeechModel;
  modelId: string;
  voiceId: string;
}

/**
 * Text to speech through the AI gateway's streaming speech (the AI SDK's
 * `streamSpeech`). Audio chunks are turned into frames as they arrive, so the
 * first sound plays before the sentence is finished.
 */
export class GatewayTTS extends tts.TTS {
  label = "tessel.GatewayTTS";
  readonly #opts: GatewayTTSOptions;

  constructor(opts: GatewayTTSOptions) {
    super(TTS_SAMPLE_RATE, CHANNELS, { streaming: false });
    this.#opts = opts;
  }

  override get model(): string {
    return this.#opts.modelId;
  }

  override get provider(): string {
    return "ai-gateway";
  }

  synthesize(
    text: string,
    connOptions: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    abortSignal?: AbortSignal,
  ): GatewayChunkedStream {
    return new GatewayChunkedStream(this, text, this.#opts, connOptions, abortSignal);
  }

  stream(): tts.SynthesizeStream {
    throw new Error("Wrap GatewayTTS in a StreamAdapter (see gatewayTTS) to stream it");
  }
}

export class GatewayChunkedStream extends tts.ChunkedStream {
  label = "tessel.GatewayChunkedStream";
  readonly #opts: GatewayTTSOptions;
  readonly #text: string;

  constructor(
    owner: GatewayTTS,
    text: string,
    opts: GatewayTTSOptions,
    connOptions: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, owner, connOptions, abortSignal);
    this.#opts = opts;
    this.#text = text;
  }

  protected async run(): Promise<void> {
    const requestId = shortuuid();
    const bytes = new AudioByteStream(TTS_SAMPLE_RATE, CHANNELS);
    // Hold one frame back, so the last one can be marked final.
    let pending: tts.SynthesizedAudio | undefined;
    const send = (frame: AudioFrame) => {
      if (pending) this.queue.put(pending);
      pending = { requestId, segmentId: requestId, frame, final: false };
    };
    try {
      const result = streamSpeech({
        model: this.#opts.model,
        text: this.#text,
        voice: this.#opts.voiceId,
        outputFormat: { type: "audio/pcm", rate: TTS_SAMPLE_RATE },
        abortSignal: this.abortController.signal,
      });
      for await (const chunk of result.audioStream) {
        const data = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
        for (const frame of bytes.write(data as ArrayBuffer)) {
          send(frame);
        }
      }
      for (const frame of bytes.flush()) send(frame);
      if (pending) this.queue.put({ ...pending, final: true });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    } finally {
      this.queue.close();
    }
  }
}

/**
 * Gateway speech as a streaming TTS: the model's reply is cut into sentences
 * as it arrives, and each sentence is spoken as soon as it is complete.
 */
export function gatewayTTS(opts: GatewayTTSOptions): tts.TTS {
  return new tts.StreamAdapter(
    new GatewayTTS(opts),
    // Short first chunks get audio started sooner; later ones are full sentences.
    new tokenize.basic.SentenceTokenizer({ minSentenceLength: 12 }),
  );
}
