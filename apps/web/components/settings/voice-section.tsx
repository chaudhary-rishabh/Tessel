"use client";

import { ApiClientError } from "@tessel/api-client";
import { useApi, useVoiceActions, useVoices } from "@tessel/api-client/react";
import type { VoiceOption } from "@tessel/contracts";
import { Button, cn, Dialog, DialogClose, DialogContent, Spinner } from "@tessel/ui";
import { Mic, Play, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/form-error";
import { useToasts } from "@/lib/toast-store";
import { VoiceRecorder } from "./voice-recorder";

/** Plays one preview at a time; playing another stops the first. */
function usePreview(workspaceId: string) {
  const api = useApi();
  const audio = useRef<HTMLAudioElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const [playing, setPlaying] = useState<string>();
  const [loading, setLoading] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const cache = urls.current;
    return () => {
      audio.current?.pause();
      for (const url of cache.values()) URL.revokeObjectURL(url);
    };
  }, []);

  const stop = () => {
    audio.current?.pause();
    setPlaying(undefined);
  };

  async function play(voiceId: string) {
    stop();
    setError(undefined);
    let url = urls.current.get(voiceId);
    if (!url) {
      setLoading(voiceId);
      try {
        url = URL.createObjectURL(await api.voice.voicePreview(workspaceId, voiceId));
        urls.current.set(voiceId, url);
      } catch {
        setError("The preview couldn't play. Try again.");
        return;
      } finally {
        setLoading(undefined);
      }
    }
    const element = new Audio(url);
    audio.current = element;
    element.onended = () => setPlaying(undefined);
    setPlaying(voiceId);
    await element.play().catch(() => setPlaying(undefined));
  }

  return { play, stop, playing, loading, error };
}

function VoiceRow({
  voice,
  selected,
  preview,
  onSelect,
  onDelete,
}: {
  voice: VoiceOption;
  selected: boolean;
  preview: ReturnType<typeof usePreview>;
  onSelect: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const playing = preview.playing === voice.id;
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        selected ? "border-accent bg-accent/6" : "border-line",
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
        <input
          type="radio"
          name="voice"
          checked={selected}
          onChange={onSelect}
          className="accent-accent size-4 shrink-0"
        />
        <span className="min-w-0">
          <span className="block truncate font-medium">{voice.name}</span>
          <span className="text-muted block truncate text-xs">{voice.description}</span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => (playing ? preview.stop() : void preview.play(voice.id))}
        aria-label={playing ? `Stop ${voice.name}` : `Hear ${voice.name}`}
        className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent grid size-9 place-items-center rounded-full focus-visible:outline-2"
      >
        {preview.loading === voice.id ? (
          <Spinner label={`Loading ${voice.name}`} className="size-4" />
        ) : playing ? (
          <Square className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Play className="size-4" aria-hidden="true" />
        )}
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${voice.name}`}
          className="text-muted hover:text-danger hover:bg-danger/8 focus-visible:outline-accent grid size-9 place-items-center rounded-full focus-visible:outline-2"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

/** Which voice Tessel speaks with in voice mode, including the user's own. */
export function VoiceSection({ workspaceId }: { workspaceId: string }) {
  const voices = useVoices(workspaceId);
  const actions = useVoiceActions(workspaceId);
  const preview = usePreview(workspaceId);
  const toast = useToasts((state) => state.show);
  const [recording, setRecording] = useState(false);
  const [deleting, setDeleting] = useState<VoiceOption>();
  const [error, setError] = useState<string>();
  // The choice shows at once, before the server confirms it.
  const [choosing, setChoosing] = useState<string>();

  if (voices.isPending) return <Spinner label="Loading voices" />;
  if (voices.isError) return <FormError message="Voices couldn't load. Refresh to try again." />;

  const { voices: options, ownVoice } = voices.data;
  const selectedId = choosing ?? voices.data.selectedId;
  const stock = options.filter((voice) => voice.kind === "stock");
  const own = options.filter((voice) => voice.kind === "own");

  const select = (voiceId: string) => {
    setError(undefined);
    setChoosing(voiceId);
    actions.select.mutate(voiceId, {
      onError: () => setError("Your choice couldn't be saved. Try again."),
      onSettled: () => setChoosing(undefined),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Tessel&apos;s voice</legend>
        <ul className="flex flex-col gap-2">
          {[...own, ...stock].map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              selected={voice.id === selectedId}
              preview={preview}
              onSelect={() => select(voice.id)}
              onDelete={voice.kind === "own" ? () => setDeleting(voice) : undefined}
            />
          ))}
        </ul>
        <FormError message={error ?? preview.error} />
      </fieldset>

      {ownVoice.available ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted text-sm">
            {own.length
              ? "Recording again replaces your voice."
              : "Tessel can talk with you in your own voice. Recording takes about half a minute."}
          </p>
          <Button variant="secondary" onClick={() => setRecording(true)}>
            <Mic className="size-4" aria-hidden="true" />
            {own.length ? "Record your voice again" : "Add your voice"}
          </Button>
        </div>
      ) : ownVoice.reason === "plan" ? (
        <p className="text-muted text-sm">
          Talk with Tessel in your own voice on a paid plan.{" "}
          <Link href="/settings#plan" className="text-accent font-medium hover:underline">
            See plans
          </Link>
        </p>
      ) : null}

      <Dialog open={recording} onOpenChange={setRecording}>
        <DialogContent title="Add your voice" className="max-w-lg">
          {recording ? (
            <VoiceRecorder
              workspaceId={workspaceId}
              adding={actions.add.isPending}
              onAdd={async (input) => {
                await actions.add.mutateAsync(input);
                setRecording(false);
                toast("Your voice is ready. Tessel will use it in voice mode.");
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (open ? null : setDeleting(undefined))}
      >
        <DialogContent
          title="Delete your voice?"
          description="Tessel goes back to a stock voice, and the copy of your voice is deleted from ElevenLabs too."
        >
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={actions.remove.isPending}
              onClick={() => {
                if (!deleting) return;
                actions.remove.mutate(deleting.id.slice("own:".length), {
                  onSuccess: () => {
                    setDeleting(undefined);
                    toast("Your voice was deleted.");
                  },
                  onError: (removeError) =>
                    setError(
                      removeError instanceof ApiClientError
                        ? removeError.message
                        : "Your voice couldn't be deleted. Try again.",
                    ),
                });
              }}
            >
              Delete voice
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
