"use client";

import {
  RoomAudioRenderer,
  RoomContext,
  StartAudio,
  useLocalParticipant,
  useMultibandTrackVolume,
  useTrackVolume,
  useTranscriptions,
  useVoiceAssistant,
} from "@livekit/components-react";
import { ApiClientError } from "@tessel/api-client";
import { queryKeys, useApi, useModels } from "@tessel/api-client/react";
import { VOICE_INTERRUPT_RPC, type VoiceSession } from "@tessel/contracts";
import { Takeover, cn } from "@tessel/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Captions, CaptionsOff, Mic, MicOff, PhoneOff, RotateCcw } from "lucide-react";
import { DisconnectReason, type LocalAudioTrack, Room, RoomEvent } from "livekit-client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chatErrorMessage } from "@/lib/chat-errors";
import { useToasts } from "@/lib/toast-store";
import { useVoiceStore, type VoiceRequest } from "@/lib/voice-store";
import { VoiceMark, type VoiceMarkMode } from "./voice-mark";

/** How long to wait for the agent to join before saying it isn't answering. */
const AGENT_JOIN_TIMEOUT_MS = 15_000;

const CONTROL =
  "focus-visible:outline-mint grid size-14 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4";

function startError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "voice_unavailable") return "Voice isn't set up on this server yet.";
    return chatErrorMessage(error.code, error.message);
  }
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "Tessel needs your microphone for voice. Allow it in your browser's site settings, then try again.";
    if (error.name === "NotFoundError")
      return "No microphone was found. Connect one and try again.";
    if (error.name === "NotReadableError")
      return "Your microphone is in use by another app. Close it there and try again.";
  }
  return "The voice conversation couldn't start. Check your connection and try again.";
}

const formatClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The full-screen voice conversation, open while a voice request is set. */
export function VoiceMode() {
  const request = useVoiceStore((state) => state.request);
  const [attempt, setAttempt] = useState(0);
  if (!request) return null;
  return (
    <VoiceConversation
      key={attempt}
      request={request}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function VoiceConversation({ request, onRetry }: { request: VoiceRequest; onRetry: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const close = useVoiceStore((state) => state.close);
  const toast = useToasts((state) => state.show);
  const [room] = useState(
    () =>
      new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
  );
  const [session, setSession] = useState<VoiceSession>();
  const [failure, setFailure] = useState<string>();
  const sessionRef = useRef<VoiceSession | undefined>(undefined);
  const ended = useRef(false);
  const started = useRef(false);
  // Only a room that connected can "end"; a failed connection shows the error instead.
  const connected = useRef(false);

  const end = useCallback(
    async (note?: string) => {
      if (ended.current) return;
      ended.current = true;
      const current = sessionRef.current;
      if (current) {
        void api.voice.end(request.workspaceId, current.sessionId).catch(() => undefined);
      }
      await room.disconnect().catch(() => undefined);
      // What was said is in the chat now.
      void queryClient.invalidateQueries({ queryKey: queryKeys.threads(request.workspaceId) });
      close();
      if (current && pathname !== `/chat/${current.threadId}`) {
        router.push(`/chat/${current.threadId}`);
      }
      if (note) toast(note);
    },
    [api, close, pathname, queryClient, request.workspaceId, room, router, toast],
  );

  // Start once: the microphone (with audio buffered until the agent joins, so
  // the user can talk right away) and the session at the same time.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const microphone = room.localParticipant.setMicrophoneEnabled(true, undefined, {
      preConnectBuffer: true,
    });
    void (async () => {
      try {
        const next = await api.voice.start(request.workspaceId, {
          ...(request.threadId ? { threadId: request.threadId } : {}),
          ...(request.model ? { model: request.model } : {}),
        });
        sessionRef.current = next;
        setSession(next);
        await Promise.all([microphone, room.connect(next.url, next.token)]);
        connected.current = true;
      } catch (error) {
        const current = sessionRef.current;
        if (current) void api.voice.end(request.workspaceId, current.sessionId).catch(() => {});
        sessionRef.current = undefined;
        await room.disconnect().catch(() => undefined);
        setFailure(startError(error));
      }
    })();
  }, [api, request, room]);

  // The server or the network ended the call.
  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (
        ended.current ||
        failure ||
        !connected.current ||
        reason === DisconnectReason.CLIENT_INITIATED
      )
        return;
      void end("The voice conversation ended.");
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [end, failure, room]);

  // Leaving the app (signing out) ends the call; the deferred check survives
  // React's development double mount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => {
        if (!alive.current && !ended.current) void end();
      }, 0);
    };
  }, [end]);

  // Keep a phone's screen on during the call.
  useEffect(() => {
    let lock: WakeLockSentinel | undefined;
    navigator.wakeLock
      ?.request("screen")
      .then((sentinel) => (lock = sentinel))
      .catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, []);

  return (
    <Takeover
      label="Voice conversation"
      onClose={() => void end()}
      className="bg-forest text-tile-paper"
    >
      <RoomContext.Provider value={room}>
        <RoomAudioRenderer />
        {failure ? (
          <FailedStart
            message={failure}
            onRetry={() => {
              ended.current = true;
              onRetry();
            }}
            onClose={() => {
              ended.current = true;
              close();
            }}
          />
        ) : (
          <VoiceStage
            session={session}
            onEnd={(note) => void end(note)}
            onAgentMissing={() => {
              void end();
              toast("Tessel's voice didn't answer. Try again in a moment.", "error");
            }}
          />
        )}
      </RoomContext.Provider>
    </Takeover>
  );
}

function FailedStart({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <VoiceMark mode="muted" bands={[]} level={0} className="size-32" />
      <p role="alert" className="max-w-sm text-lg text-balance">
        {message}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="bg-mint text-forest focus-visible:outline-mint inline-flex h-12 items-center gap-2 rounded-full px-6 font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </button>
        <button
          type="button"
          onClick={onClose}
          className="focus-visible:outline-mint h-12 rounded-full border border-white/25 px-6 font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function VoiceStage({
  session,
  onEnd,
  onAgentMissing,
}: {
  session: VoiceSession | undefined;
  onEnd: (note?: string) => void;
  onAgentMissing: () => void;
}) {
  const { agent, state, audioTrack } = useVoiceAssistant();
  const { localParticipant, microphoneTrack, isMicrophoneEnabled } = useLocalParticipant();
  const models = useModels();
  const [captions, setCaptions] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const agentSeen = useRef(false);

  const bands = useMultibandTrackVolume(audioTrack, { bands: 5, loPass: 100, hiPass: 600 });
  const level = useTrackVolume(microphoneTrack?.track as LocalAudioTrack | undefined);

  // The agent leaving ends the call (it said why: a limit, or the time is up).
  useEffect(() => {
    if (agent) agentSeen.current = true;
    else if (agentSeen.current) onEnd();
  }, [agent, onEnd]);

  useEffect(() => {
    if (!session || agent) return;
    const timer = setTimeout(onAgentMissing, AGENT_JOIN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [agent, onAgentMissing, session]);

  // The clock starts when Tessel is there to talk to.
  useEffect(() => {
    if (!agent) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 1000);
    return () => clearInterval(timer);
  }, [agent]);

  const muted = !isMicrophoneEnabled;
  const mode: VoiceMarkMode =
    muted && state !== "speaking"
      ? "muted"
      : state === "speaking"
        ? "speaking"
        : state === "thinking"
          ? "thinking"
          : state === "listening" || state === "pre-connect-buffering"
            ? "listening"
            : "connecting";

  const interrupt = () => {
    if (!agent || state !== "speaking") return;
    void localParticipant
      .performRpc({ destinationIdentity: agent.identity, method: VOICE_INTERRUPT_RPC, payload: "" })
      .catch(() => undefined);
  };

  const remaining = session ? session.maxDurationSeconds - elapsed : Infinity;
  const modelLabel = models.data?.models.find((model) => model.id === session?.modelId)?.label;
  const lines = useCaptionLines();

  return (
    <VoiceStageView
      mode={mode}
      bands={bands}
      level={level}
      muted={muted}
      clock={remaining <= 60 ? "Less than a minute left" : formatClock(elapsed)}
      ending={remaining <= 60}
      modelLabel={modelLabel}
      captions={captions ? lines : undefined}
      onInterrupt={interrupt}
      onToggleMute={() => void localParticipant.setMicrophoneEnabled(muted)}
      onToggleCaptions={() => setCaptions((shown) => !shown)}
      onEnd={() => onEnd()}
    >
      {/* Shown only when the browser blocked playback (Safari can, until a tap). */}
      <StartAudio
        label="Tap to hear Tessel"
        className="bg-mint text-forest mx-auto mb-2 h-11 rounded-full px-5 font-medium"
      />
    </VoiceStageView>
  );
}

const STATUS: Record<VoiceMarkMode, string> = {
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Tap to interrupt",
  muted: "Your microphone is off",
};

/** How the conversation looks, given its state; `VoiceStage` feeds it from LiveKit. */
export function VoiceStageView({
  mode,
  bands,
  level,
  muted,
  clock,
  ending = false,
  modelLabel,
  captions,
  onInterrupt,
  onToggleMute,
  onToggleCaptions,
  onEnd,
  children,
}: {
  mode: VoiceMarkMode;
  bands: number[];
  level: number;
  muted: boolean;
  clock: string;
  /** Close to the time limit: the clock turns into a warning. */
  ending?: boolean;
  modelLabel?: string | undefined;
  /** Caption lines, or undefined while captions are hidden. */
  captions?: { you?: string | undefined; tessel?: string | undefined } | undefined;
  onInterrupt: () => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
  onEnd: () => void;
  children?: ReactNode;
}) {
  const status = STATUS[mode];
  return (
    <div className="relative flex flex-1 flex-col">
      <header className="flex items-center justify-between px-5 pt-4 sm:px-8 sm:pt-6">
        <div className="text-sm text-white/70">
          <span className="text-tile-paper font-display text-base font-semibold">Voice</span>
          {modelLabel ? <span className="ml-2">{modelLabel}</span> : null}
        </div>
        <div
          className={cn("text-sm tabular-nums", ending ? "text-tile-ochre" : "text-white/70")}
          aria-label="Call length"
        >
          {clock}
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <button
          type="button"
          onClick={onInterrupt}
          disabled={mode !== "speaking"}
          aria-label={mode === "speaking" ? "Interrupt Tessel" : status}
          className="focus-visible:outline-mint rounded-[2rem] p-4 focus-visible:outline-2 disabled:cursor-default"
        >
          <VoiceMark mode={mode} bands={bands} level={level} className="size-[min(56vmin,17rem)]" />
        </button>
        <p role="status" aria-live="polite" className="text-lg text-white/80">
          {status}
        </p>
      </div>

      {children}
      <div
        className="mx-auto flex h-28 w-full max-w-xl flex-col justify-end gap-2 overflow-hidden px-6 text-center"
        aria-hidden="true"
      >
        {captions?.tessel && !captions.you ? (
          <p className="text-xl leading-snug text-balance">{captions.tessel}</p>
        ) : null}
        {captions?.you ? (
          <p className="text-lg leading-snug text-balance text-white/60">{captions.you}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-5 px-6 pt-8 pb-8 sm:pb-12">
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Turn microphone on" : "Turn microphone off"}
          aria-pressed={muted}
          className={cn(
            CONTROL,
            muted ? "bg-tile-paper text-forest" : "bg-white/10 hover:bg-white/20",
          )}
        >
          {muted ? (
            <MicOff className="size-6" aria-hidden="true" />
          ) : (
            <Mic className="size-6" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onToggleCaptions}
          aria-label={captions ? "Hide captions" : "Show captions"}
          aria-pressed={Boolean(captions)}
          className={cn(CONTROL, "bg-white/10 hover:bg-white/20")}
        >
          {captions ? (
            <Captions className="size-6" aria-hidden="true" />
          ) : (
            <CaptionsOff className="size-6" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="bg-danger focus-visible:outline-mint inline-flex h-14 items-center gap-2 rounded-full px-7 font-medium text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          <PhoneOff className="size-5" aria-hidden="true" />
          End
        </button>
      </div>
    </div>
  );
}

/** The last thing the user said, until Tessel answers it, and what Tessel is saying now. */
function useCaptionLines() {
  const transcriptions = useTranscriptions();
  const { localParticipant } = useLocalParticipant();
  return useMemo(() => {
    const own = (identity: string) => identity === localParticipant.identity;
    const lastTessel = transcriptions.findLast((item) => !own(item.participantInfo.identity));
    const lastYou = transcriptions.findLast((item) => own(item.participantInfo.identity));
    const youFirst =
      lastYou && (!lastTessel || lastYou.streamInfo.timestamp > lastTessel.streamInfo.timestamp);
    return { you: youFirst ? lastYou.text : undefined, tessel: lastTessel?.text };
  }, [localParticipant.identity, transcriptions]);
}
