/**
 * The ElevenLabs calls behind users' own voices: transcribing the recording
 * (to check the phrase was read), cloning the voice, deleting it, and
 * speaking a preview. Behind an interface so tests use a fake.
 */
export interface VoiceCloning {
  /** The words in a recording, and how long the speech in it lasts. */
  transcribe(audio: Buffer, mediaType: string): Promise<{ text: string; seconds: number }>;
  /** Clones a voice from the recording; returns the provider's voice ID. */
  createVoice(input: {
    name: string;
    description: string;
    audio: Buffer;
    mediaType: string;
  }): Promise<string>;
  deleteVoice(providerVoiceId: string): Promise<void>;
  /** A short MP3 of the voice saying `text`. */
  speak(providerVoiceId: string, text: string): Promise<Buffer>;
}

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VoiceProviderError";
  }
}

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export function createElevenLabs({
  apiKey,
  baseUrl = "https://api.elevenlabs.io",
  ttsModel = "eleven_flash_v2_5",
  fetchImpl = fetch,
}: {
  apiKey: string;
  baseUrl?: string;
  ttsModel?: string;
  fetchImpl?: typeof fetch;
}): VoiceCloning {
  async function call(path: string, init: RequestInit): Promise<Response> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { "xi-api-key": apiKey, ...init.headers },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new VoiceProviderError(
        `ElevenLabs ${init.method ?? "GET"} ${path} failed with ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
      );
    }
    return response;
  }

  const file = (audio: Buffer, mediaType: string) =>
    new File([new Uint8Array(audio)], `recording.${EXTENSIONS[mediaType] ?? "webm"}`, {
      type: mediaType,
    });

  return {
    async transcribe(audio, mediaType) {
      const form = new FormData();
      form.set("model_id", "scribe_v2");
      form.set("file", file(audio, mediaType));
      form.set("tag_audio_events", "false");
      const body = (await (
        await call("/v1/speech-to-text", { method: "POST", body: form })
      ).json()) as { text?: string; words?: { end?: number; type?: string }[] };
      const spoken = (body.words ?? []).filter((word) => word.type !== "spacing");
      return { text: body.text ?? "", seconds: spoken.at(-1)?.end ?? 0 };
    },

    async createVoice({ name, description, audio, mediaType }) {
      const form = new FormData();
      form.set("name", name);
      form.set("description", description);
      form.set("remove_background_noise", "true");
      form.append("files", file(audio, mediaType));
      const body = (await (
        await call("/v1/voices/add", { method: "POST", body: form })
      ).json()) as {
        voice_id?: string;
      };
      if (!body.voice_id) throw new VoiceProviderError("ElevenLabs returned no voice ID", 502);
      return body.voice_id;
    },

    async deleteVoice(providerVoiceId) {
      try {
        await call(`/v1/voices/${encodeURIComponent(providerVoiceId)}`, { method: "DELETE" });
      } catch (error) {
        // Already gone is what we wanted.
        if (error instanceof VoiceProviderError && error.status === 404) return;
        throw error;
      }
    },

    async speak(providerVoiceId, text) {
      const response = await call(
        `/v1/text-to-speech/${encodeURIComponent(providerVoiceId)}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text, model_id: ttsModel }),
        },
      );
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
