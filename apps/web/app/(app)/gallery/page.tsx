"use client";

import { useGallery, useMediaActions, useMediaStatus } from "@tessel/api-client/react";
import {
  IMAGE_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  type ImageAspectRatio,
  type MediaItem,
} from "@tessel/contracts";
import { Button, Spinner, cn } from "@tessel/ui";
import { Clapperboard, ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ImageViewer, type ViewedImage } from "@/components/media/image-viewer";
import { MediaImage } from "@/components/media/media-image";
import { VideoCard } from "@/components/media/video-card";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useImageReference } from "@/lib/image-reference-store";

type Kind = "image" | "video";

const IMAGE_SHAPES: Record<ImageAspectRatio, string> = {
  "1:1": "Square",
  "3:2": "Landscape 3:2",
  "2:3": "Portrait 2:3",
  "16:9": "Wide 16:9",
  "9:16": "Tall 9:16",
  "4:3": "Landscape 4:3",
  "3:4": "Portrait 3:4",
};
const VIDEO_SHAPES = { "16:9": "Landscape 16:9", "9:16": "Portrait 9:16" } as const;

const SELECT = "border-line bg-paper h-9 rounded-lg border px-2 text-sm";

function CreateForm({
  kind,
  workspaceId,
  onImage,
}: {
  kind: Kind;
  workspaceId: string;
  onImage: (item: MediaItem) => void;
}) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [imageShape, setImageShape] = useState<ImageAspectRatio>("1:1");
  const [videoShape, setVideoShape] = useState<keyof typeof VIDEO_SHAPES>("16:9");
  const [seconds, setSeconds] = useState<(typeof VIDEO_DURATIONS)[number]>(8);
  const { generateImage, startVideo } = useMediaActions(workspaceId);
  const mutation = kind === "image" ? generateImage : startVideo;
  const busy = mutation.isPending;

  function submit() {
    const text = prompt.trim();
    if (!text || busy) return;
    const done = () => setPrompt("");
    if (kind === "image") {
      generateImage.mutate(
        { prompt: text, aspectRatio: imageShape },
        {
          onSuccess: (item) => {
            done();
            onImage(item);
          },
        },
      );
    } else {
      startVideo.mutate(
        { prompt: text, aspectRatio: videoShape, durationSeconds: seconds },
        { onSuccess: done },
      );
    }
  }

  return (
    <form
      className="border-line bg-surface rounded-2xl border p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={promptId} className="sr-only">
        {kind === "image" ? "Describe an image" : "Describe a video"}
      </label>
      <textarea
        id={promptId}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        rows={2}
        maxLength={4000}
        placeholder={
          kind === "image"
            ? "Describe an image: the subject, the style, the light…"
            : "Describe a clip: the scene, the motion, the camera, the sound…"
        }
        className="placeholder:text-muted/80 block w-full resize-none bg-transparent px-2 py-1.5 text-base focus:outline-none"
      />
      {mutation.error ? (
        <p role="alert" className="text-danger px-2 pb-1 text-sm">
          {mutation.error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {kind === "image" ? (
          <select
            aria-label="Shape"
            value={imageShape}
            onChange={(event) => setImageShape(event.target.value as ImageAspectRatio)}
            className={SELECT}
          >
            {IMAGE_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {IMAGE_SHAPES[ratio]}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              aria-label="Shape"
              value={videoShape}
              onChange={(event) => setVideoShape(event.target.value as keyof typeof VIDEO_SHAPES)}
              className={SELECT}
            >
              {Object.entries(VIDEO_SHAPES).map(([ratio, label]) => (
                <option key={ratio} value={ratio}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Length"
              value={seconds}
              onChange={(event) =>
                setSeconds(Number(event.target.value) as (typeof VIDEO_DURATIONS)[number])
              }
              className={SELECT}
            >
              {VIDEO_DURATIONS.map((value) => (
                <option key={value} value={value}>
                  {value} seconds
                </option>
              ))}
            </select>
          </>
        )}
        <Button type="submit" size="sm" className="ml-auto" disabled={!prompt.trim() || busy}>
          {kind === "image" ? (
            <ImagePlus className="size-4" aria-hidden="true" />
          ) : (
            <Clapperboard className="size-4" aria-hidden="true" />
          )}
          {kind === "image" ? (busy ? "Creating…" : "Create") : busy ? "Starting…" : "Make video"}
        </Button>
      </div>
    </form>
  );
}

export default function GalleryPage() {
  const router = useRouter();
  const { current } = useCurrentWorkspace();
  const status = useMediaStatus(current?.id);
  const [kind, setKind] = useState<Kind>("image");
  const gallery = useGallery(current?.id, kind);
  const { generateImage } = useMediaActions(current?.id ?? "");
  const pointAt = useImageReference((state) => state.set);
  const [open, setOpen] = useState<(ViewedImage & { threadId?: string | null }) | null>(null);
  if (!current) return null;

  const items = gallery.data?.pages.flatMap((page) => page.items) ?? [];
  const available = kind === "image" ? status.data?.images : status.data?.videos;
  const show = (item: MediaItem) =>
    setOpen({
      id: item.id,
      width: item.width,
      height: item.height,
      alt: item.prompt,
      threadId: item.threadId,
    });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 md:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Gallery</h1>
      <p className="text-muted mt-2 max-w-prose">
        Images and videos you make here or ask for in a chat. Only you can see them.
      </p>

      <div role="tablist" aria-label="Show" className="bg-paper mt-8 inline-flex rounded-lg p-0.5">
        {(["image", "video"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={kind === option}
            onClick={() => setKind(option)}
            className={cn(
              "focus-visible:outline-accent rounded-md px-4 py-1.5 text-sm font-medium focus-visible:outline-2",
              kind === option ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            {option === "image" ? "Images" : "Videos"}
          </button>
        ))}
      </div>

      <section aria-label={kind === "image" ? "Create an image" : "Make a video"} className="mt-4">
        {available === false ? (
          <p className="border-line text-muted rounded-xl border px-4 py-3 text-sm">
            {kind === "image" ? "Image" : "Video"} generation isn&apos;t set up on this server yet.
          </p>
        ) : (
          <CreateForm key={kind} kind={kind} workspaceId={current.id} onImage={show} />
        )}
      </section>

      <section aria-label={kind === "image" ? "Your images" : "Your videos"} className="mt-10">
        {gallery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : items.length === 0 && !generateImage.isPending ? (
          <p className="text-muted py-12 text-center">
            {kind === "image"
              ? "No images yet. Describe one above, or ask for one in any chat."
              : "No videos yet. Describe one above, or ask for one in any chat."}
          </p>
        ) : kind === "image" ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {generateImage.isPending ? (
              <li
                role="status"
                className="bg-ink/6 relative flex aspect-square items-center justify-center overflow-hidden rounded-xl"
              >
                <span className="media-shimmer absolute inset-0" aria-hidden="true" />
                <span className="text-muted relative text-sm">Creating image…</span>
              </li>
            ) : null}
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => show(item)}
                  aria-label={`Open image: ${item.prompt}`}
                  className="focus-visible:outline-accent group block w-full overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <MediaImage
                    workspaceId={current.id}
                    mediaId={item.id}
                    alt={item.prompt}
                    width={1}
                    height={1}
                    className="rounded-xl transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id}>
                <VideoCard
                  workspaceId={current.id}
                  mediaId={item.id}
                  width={item.width}
                  height={item.height}
                  alt={item.prompt}
                />
              </li>
            ))}
          </ul>
        )}
        {gallery.hasNextPage ? (
          <div className="mt-6 flex justify-center">
            <Button
              variant="secondary"
              onClick={() => void gallery.fetchNextPage()}
              disabled={gallery.isFetchingNextPage}
            >
              {gallery.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          </div>
        ) : null}
      </section>

      {open ? (
        <ImageViewer
          workspaceId={current.id}
          image={open}
          editHere={status.data?.images !== false}
          onClose={() => setOpen(null)}
          onChange={(image) => setOpen(image)}
          onDeleted={() => setOpen(null)}
          onEditInChat={() => {
            pointAt(open.id);
            setOpen(null);
            router.push(open.threadId ? `/chat/${open.threadId}` : "/chat");
          }}
        />
      ) : null}
    </div>
  );
}
