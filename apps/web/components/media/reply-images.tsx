"use client";

import type { ToolCallView } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { useImageReference } from "@/lib/image-reference-store";
import { ImageViewer, type ViewedImage } from "./image-viewer";
import { MediaImage } from "./media-image";

const IMAGE_TOOLS = new Set(["generate_image", "edit_image"]);

/** The shape an image being made will have, from the call's arguments. */
function pendingRatio(call: ToolCallView): string {
  const ratio = typeof call.args.aspect_ratio === "string" ? call.args.aspect_ratio : "1:1";
  const [w, h] = ratio.split(":").map(Number);
  return w && h ? `${w} / ${h}` : "1 / 1";
}

/**
 * Images a reply made, under its text: a placeholder of the right shape
 * while one is being made, then the image, which opens full screen.
 */
export function ReplyImages({
  workspaceId,
  calls,
}: {
  workspaceId: string;
  calls: ToolCallView[];
}) {
  const [open, setOpen] = useState<ViewedImage | null>(null);
  const pointAt = useImageReference((state) => state.set);
  const imageCalls = calls.filter((call) => IMAGE_TOOLS.has(call.name));
  const making = imageCalls.filter((call) => call.status === "running");
  const made = imageCalls.flatMap((call) =>
    call.status === "completed" ? (call.media ?? []).filter((item) => item.kind === "image") : [],
  );
  if (making.length === 0 && made.length === 0) return null;
  const count = making.length + made.length;

  return (
    <>
      <div
        className={cn("grid gap-2", count === 1 ? "max-w-md grid-cols-1" : "max-w-2xl grid-cols-2")}
      >
        {made.map((image) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setOpen(image)}
            className="focus-visible:outline-accent group/image block overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={`Open image: ${image.alt ?? "generated image"}`}
          >
            <MediaImage
              workspaceId={workspaceId}
              mediaId={image.id}
              alt={image.alt ?? "Generated image"}
              width={image.width}
              height={image.height}
              className="rounded-xl transition-transform duration-300 group-hover/image:scale-[1.015] motion-reduce:transition-none"
            />
          </button>
        ))}
        {making.map((call) => (
          <div
            key={call.id}
            role="status"
            className="bg-ink/6 border-line relative flex items-center justify-center overflow-hidden rounded-xl border"
            style={{ aspectRatio: pendingRatio(call) }}
          >
            <span className="media-shimmer absolute inset-0" aria-hidden="true" />
            <span className="text-muted relative flex items-center gap-2 text-sm">
              <ImagePlus className="size-4" aria-hidden="true" />
              {call.name === "edit_image" ? "Editing image…" : "Creating image…"}
            </span>
          </div>
        ))}
      </div>
      {open ? (
        <ImageViewer
          workspaceId={workspaceId}
          image={open}
          onClose={() => setOpen(null)}
          onEditInChat={() => {
            pointAt(open.id);
            setOpen(null);
            // The composer takes focus so the change can be typed right away.
            requestAnimationFrame(() =>
              document.querySelector<HTMLTextAreaElement>("textarea[data-composer]")?.focus(),
            );
          }}
        />
      ) : null}
    </>
  );
}
