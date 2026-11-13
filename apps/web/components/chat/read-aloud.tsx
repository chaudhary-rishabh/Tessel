"use client";

import { useApi, useVoiceStatus } from "@tessel/api-client/react";
import { Spinner } from "@tessel/ui";
import { Square, Volume2 } from "lucide-react";
import { create } from "zustand";
import { useToasts } from "@/lib/toast-store";

interface ReadAloudState {
  /** The reply being fetched or read, and which of the two. */
  messageId: string | null;
  phase: "loading" | "playing" | null;
  audio: HTMLAudioElement | null;
  url: string | null;
  set(patch: Partial<Omit<ReadAloudState, "set" | "stop">>): void;
  stop(): void;
}

/** One reply reads at a time across the app; starting another stops the first. */
const useReadAloud = create<ReadAloudState>((set, get) => ({
  messageId: null,
  phase: null,
  audio: null,
  url: null,
  set: (patch) => set(patch),
  stop() {
    const { audio, url } = get();
    audio?.pause();
    if (url) URL.revokeObjectURL(url);
    set({ messageId: null, phase: null, audio: null, url: null });
  },
}));

const ACTION =
  "text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2";

/** Reads a reply aloud in the user's chosen voice. Shown when the server can speak. */
export function ReadAloudButton({
  workspaceId,
  messageId,
}: {
  workspaceId: string;
  messageId: string;
}) {
  const api = useApi();
  const status = useVoiceStatus(workspaceId);
  const toast = useToasts((state) => state.show);
  const mine = useReadAloud((state) => (state.messageId === messageId ? state.phase : null));
  if (!status.data?.readAloud) return null;

  async function start() {
    const store = useReadAloud.getState();
    store.stop();
    store.set({ messageId, phase: "loading" });
    try {
      const blob = await api.voice.speak(workspaceId, messageId);
      // Stopped, or another reply started, while this one loaded.
      if (useReadAloud.getState().messageId !== messageId) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        if (useReadAloud.getState().audio === audio) useReadAloud.getState().stop();
      };
      store.set({ audio, url, phase: "playing" });
      await audio.play();
    } catch {
      if (useReadAloud.getState().messageId === messageId) useReadAloud.getState().stop();
      toast("This reply couldn't be read aloud. Try again.", "error");
    }
  }

  return (
    <button
      type="button"
      className={ACTION}
      aria-label={mine ? "Stop reading" : "Read aloud"}
      aria-pressed={Boolean(mine)}
      onClick={() => (mine ? useReadAloud.getState().stop() : void start())}
    >
      {mine === "loading" ? (
        <Spinner label="Getting the audio" className="size-4" />
      ) : mine === "playing" ? (
        <Square className="size-3.5 fill-current" aria-hidden="true" />
      ) : (
        <Volume2 className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
