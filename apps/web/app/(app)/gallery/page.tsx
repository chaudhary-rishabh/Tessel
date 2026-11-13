"use client";

import { useGallery, useMediaActions, useMediaStatus } from "@tessel/api-client/react";
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio, type MediaItem } from "@tessel/contracts";
import { Button, Spinner, cn } from "@tessel/ui";
import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ImageViewer, type ViewedImage } from "@/components/media/image-viewer";
import { MediaImage } from "@/components/media/media-image";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useImageReference } from "@/lib/image-reference-store";

const SHAPES: Record<ImageAspectRatio, string> = {
  "1:1": "Square",
  "3:2": "Landscape 3:2",
  "2:3": "Portrait 2:3",
  "16:9": "Wide 16:9",
  "9:16": "Tall 9:16",
  "4:3": "Landscape 4:3",
  "3:4": "Portrait 3:4",
};

function CreateImage({
  generateImage,
  onMade,
}: {
  generateImage: ReturnType<typeof useMediaActions>["generateImage"];
  onMade: (item: MediaItem) => void;
}) {
  const promptId = useId();
  const shapeId = useId();
  const [prompt, setPrompt] = useState("");
  const [shape, setShape] = useState<ImageAspectRatio>("1:1");

  return (
    <form
      className="border-line bg-surface rounded-2xl border p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const text = prompt.trim();
        if (!text || generateImage.isPending) return;
        generateImage.mutate(
          { prompt: text, aspectRatio: shape },
          {
            onSuccess: (item) => {
              setPrompt("");
              onMade(item);
            },
          },
        );
      }}
    >
      <label htmlFor={promptId} className="sr-only">
        Describe an image
      </label>
      <textarea
        id={promptId}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        rows={2}
        maxLength={4000}
        placeholder="Describe an image: the subject, the style, the light…"
        className="placeholder:text-muted/80 block w-full resize-none bg-transparent px-2 py-1.5 text-base focus:outline-none"
      />
      {generateImage.error ? (
        <p role="alert" className="text-danger px-2 pb-1 text-sm">
          {generateImage.error.message}
        </p>
      ) : null}
      <div className="flex items-center gap-2 pt-1">
        <label htmlFor={shapeId} className="sr-only">
          Shape
        </label>
        <select
          id={shapeId}
          value={shape}
          onChange={(event) => setShape(event.target.value as ImageAspectRatio)}
          className="border-line bg-paper h-9 rounded-lg border px-2 text-sm"
        >
          {IMAGE_ASPECT_RATIOS.map((ratio) => (
            <option key={ratio} value={ratio}>
              {SHAPES[ratio]}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          className="ml-auto"
          disabled={!prompt.trim() || generateImage.isPending}
        >
          <ImagePlus className="size-4" aria-hidden="true" />
          {generateImage.isPending ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}

export default function GalleryPage() {
  const router = useRouter();
  const { current } = useCurrentWorkspace();
  const status = useMediaStatus(current?.id);
  const gallery = useGallery(current?.id, "image");
  const { generateImage } = useMediaActions(current?.id ?? "");
  const pointAt = useImageReference((state) => state.set);
  const [open, setOpen] = useState<(ViewedImage & { threadId?: string | null }) | null>(null);
  if (!current) return null;

  const items = gallery.data?.pages.flatMap((page) => page.items) ?? [];
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
      <h1 className="text-3xl font-semibold tracking-tight">Images</h1>
      <p className="text-muted mt-2 max-w-prose">
        Images you make here or ask for in a chat. Only you can see them.
      </p>

      <section aria-label="Create an image" className="mt-8">
        {status.data?.images === false ? (
          <p className="border-line text-muted rounded-xl border px-4 py-3 text-sm">
            Image generation isn&apos;t set up on this server yet.
          </p>
        ) : (
          <CreateImage generateImage={generateImage} onMade={show} />
        )}
      </section>

      <section aria-labelledby="gallery-heading" className="mt-10">
        <h2 id="gallery-heading" className="sr-only">
          Your images
        </h2>
        {gallery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : items.length === 0 && !generateImage.isPending ? (
          <p className="text-muted py-12 text-center">
            No images yet. Describe one above, or ask for one in any chat.
          </p>
        ) : (
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
                    className={cn(
                      "rounded-xl transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none",
                    )}
                  />
                </button>
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
