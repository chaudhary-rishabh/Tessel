"use client";

import { ApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import type { VoiceChallenge } from "@tessel/contracts";
import { Button, Spinner, TextField } from "@tessel/ui";
import { Circle, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { FormError } from "@/components/form-error";

type Step =
  | { name: "consent" }
  | { name: "ready"; challenge: VoiceChallenge }
  | { name: "recording"; challenge: VoiceChallenge }
  | { name: "review"; challenge: VoiceChallenge; recording: Blob; url: string };

/** The formats browsers can record, best first (Safari records MP4). */
const FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

const ADD_ERRORS: Record<string, string> = {
  voice_code_not_heard:
    "We couldn't hear your code in the recording. Read the last sentence clearly and try again.",
  voice_recording_too_short: "Read the whole passage: the recording needs more speech.",
  voice_recording_unusable: "That recording couldn't be used. Record somewhere quieter.",
  voice_challenge_expired: "This recording took too long. Start again.",
  voice_challenge_invalid: "Something went wrong with this recording. Start again.",
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Adding the user's own voice: they agree, read a passage that ends with a
 * one-time code, listen back, and send it. The server checks the code was
 * read before cloning, so nobody can add a recording of someone else.
 */
export function VoiceRecorder({
  workspaceId,
  adding,
  onAdd,
}: {
  workspaceId: string;
  adding: boolean;
  onAdd: (input: { token: string; name: string; recording: Blob }) => Promise<void>;
}) {
  const api = useApi();
  const consentId = useId();
  const [step, setStep] = useState<Step>({ name: "consent" });
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("My voice");
  const [error, setError] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [loading, setLoading] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopMeter = useRef<() => void>(() => undefined);

  // Let go of the microphone and the preview when the dialog closes.
  useEffect(
    () => () => {
      stopMeter.current();
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  useEffect(() => {
    if (step.name !== "review") return;
    return () => URL.revokeObjectURL(step.url);
  }, [step]);

  async function begin() {
    setError(undefined);
    setLoading(true);
    try {
      setStep({ name: "ready", challenge: await api.voice.voiceChallenge(workspaceId) });
    } catch (startError) {
      setError(
        startError instanceof ApiClientError
          ? startError.message
          : "Couldn't start. Check your connection.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function record(challenge: VoiceChallenge) {
    setError(undefined);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      setError(
        "Tessel needs your microphone to record. Allow it in your browser's site settings, then try again.",
      );
      return;
    }
    const mimeType = FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      stopMeter.current();
      stream.getTracks().forEach((track) => track.stop());
      const recording = new Blob(chunks, { type: media.mimeType || "audio/webm" });
      setStep({ name: "review", challenge, recording, url: URL.createObjectURL(recording) });
    };

    // A level meter, so it's clear the microphone hears them.
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      setLevel(Math.min(1, peak * 1.6));
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= challenge.maxSeconds && media.state === "recording") media.stop();
    }, 100);
    stopMeter.current = () => {
      clearInterval(timer);
      void context.close().catch(() => undefined);
      setLevel(0);
    };

    recorder.current = media;
    setElapsed(0);
    media.start(1000);
    setStep({ name: "recording", challenge });
  }

  async function send(review: Extract<Step, { name: "review" }>) {
    setError(undefined);
    try {
      await onAdd({ token: review.challenge.token, name, recording: review.recording });
    } catch (addError) {
      if (addError instanceof ApiClientError) {
        setError(ADD_ERRORS[addError.code] ?? addError.message);
        if (
          addError.code === "voice_challenge_expired" ||
          addError.code === "voice_challenge_invalid"
        )
          setStep({ name: "consent" });
      } else {
        setError("Your voice couldn't be added. Try again.");
      }
    }
  }

  if (step.name === "consent") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted text-sm">
          Tessel makes a copy of your voice with ElevenLabs, our voice provider, so it can talk with
          you in it. Only you can use it, the recording isn&apos;t kept, and you can delete your
          voice at any time.
        </p>
        <label htmlFor={consentId} className="flex items-start gap-3 text-sm">
          <input
            id={consentId}
            type="checkbox"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            className="accent-accent mt-0.5 size-4"
          />
          <span>
            This is my own voice, and I agree to Tessel making a copy of it for my account.
          </span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button disabled={!agreed} loading={loading} onClick={() => void begin()}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  const { challenge } = step;
  const recording = step.name === "recording";
  const enough = elapsed >= challenge.minSeconds;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted text-sm">
        In a quiet place, read this out loud at your normal pace, including the last sentence.
      </p>
      <blockquote className="border-line bg-paper rounded-xl border p-4 leading-relaxed">
        <p>{challenge.passage}</p>
        <p className="mt-3 font-semibold">{challenge.phrase}</p>
      </blockquote>

      {step.name === "review" ? (
        <div className="flex flex-col gap-3">
          <audio controls src={step.url} className="w-full" aria-label="Your recording" />
          <TextField
            label="Name for your voice"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => (recording ? recorder.current?.stop() : void record(challenge))}
            disabled={recording && !enough}
            aria-label={recording ? "Stop recording" : "Start recording"}
            className="bg-danger focus-visible:outline-accent grid size-14 shrink-0 place-items-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          >
            {recording ? (
              <Square className="size-5 fill-current" aria-hidden="true" />
            ) : (
              <Circle className="size-5 fill-current" aria-hidden="true" />
            )}
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="bg-line h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-accent h-full rounded-full transition-[width] duration-100"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <p className="text-muted text-sm tabular-nums" role="status">
              {recording
                ? enough
                  ? `${clock(elapsed)}. Stop when you've read the last sentence.`
                  : `${clock(elapsed)}. Keep reading…`
                : "Press record, then start reading."}
            </p>
          </div>
        </div>
      )}

      <FormError message={error} />
      {step.name === "review" ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={adding} onClick={() => void record(challenge)}>
            Record again
          </Button>
          <Button loading={adding} onClick={() => void send(step)}>
            Add my voice
          </Button>
        </div>
      ) : null}
      {adding ? (
        <p className="text-muted flex items-center gap-2 text-sm" role="status">
          <Spinner label="" /> Making your voice. This takes a few seconds.
        </p>
      ) : null}
    </div>
  );
}
