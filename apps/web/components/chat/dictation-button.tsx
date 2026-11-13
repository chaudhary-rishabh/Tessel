"use client";

import { useApi } from "@tessel/api-client/react";
import { Spinner, cn } from "@tessel/ui";
import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
/** Matches the server's limit for one dictation. */
const MAX_SECONDS = 120;

/**
 * Speaks a message into the composer: record, stop, and the words land in
 * the text box to edit before sending.
 */
export function DictationButton({
  workspaceId,
  onText,
  onError,
}: {
  workspaceId: string;
  onText: (text: string) => void;
  onError: (message: string) => void;
}) {
  const api = useApi();
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("Tessel needs your microphone to listen. Allow it in your browser's site settings.");
      return;
    }
    const mimeType = FORMATS.find((format) => MediaRecorder.isTypeSupported(format));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS && media.state === "recording") media.stop();
    }, 250);
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      if (cancelled.current) return;
      setPhase("transcribing");
      try {
        const text = await api.voice.transcribe(
          workspaceId,
          new Blob(chunks, { type: media.mimeType || "audio/webm" }),
        );
        if (text) onText(text);
        else onError("No speech was heard. Try again a little closer to the microphone.");
      } catch {
        onError("What you said couldn't be turned into text. Try again.");
      } finally {
        setPhase("idle");
      }
    };
    recorder.current = media;
    cancelled.current = false;
    setElapsed(0);
    media.start(500);
    setPhase("recording");
  }

  const recording = phase === "recording";
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => (recording ? recorder.current?.stop() : void start())}
        disabled={phase === "transcribing"}
        aria-label={recording ? "Stop dictating" : "Dictate"}
        aria-pressed={recording}
        onKeyDown={(event) => {
          if (event.key === "Escape" && recording) {
            cancelled.current = true;
            recorder.current?.stop();
            setPhase("idle");
          }
        }}
        className={cn(
          "focus-visible:outline-accent flex size-10 items-center justify-center rounded-lg focus-visible:outline-2 disabled:opacity-60",
          recording ? "bg-danger/10 text-danger" : "text-muted hover:text-ink hover:bg-ink/6",
        )}
      >
        {phase === "transcribing" ? (
          <Spinner label="Turning speech into text" className="size-4" />
        ) : recording ? (
          <Square className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Mic className="size-5" aria-hidden="true" />
        )}
      </button>
      {recording ? (
        <span className="text-danger text-xs tabular-nums" role="status">
          {Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}
        </span>
      ) : null}
    </span>
  );
}
