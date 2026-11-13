"use client";

import { useApi, useMediaItem, useMediaUrl } from "@tessel/api-client/react";
import type { MediaItem } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { CircleAlert, Clapperboard, Download } from "lucide-react";
import { toast } from "@/lib/toast-store";

async function saveVideo(api: ReturnType<typeof useApi>, workspaceId: string, id: string) {
  const blob = await api.media.blob(workspaceId, id, "original");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tessel-video-${id.slice(0, 8)}.mp4`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Player({
  workspaceId,
  item,
}: {
  workspaceId: string;
  item: Pick<MediaItem, "id" | "prompt">;
}) {
  const { url, isError } = useMediaUrl(workspaceId, item.id, "original");
  if (isError) {
    return (
      <p className="text-muted flex size-full items-center justify-center gap-2 text-sm">
        <CircleAlert className="size-4" aria-hidden="true" />
        This video couldn&apos;t load
      </p>
    );
  }
  if (!url) return <span className="media-shimmer absolute inset-0" aria-hidden="true" />;
  return (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      aria-label={item.prompt}
      className="size-full bg-black object-contain"
    />
  );
}

/**
 * A video in a reply or the gallery: its progress while it's being made,
 * then a player with download. It checks on itself until it's done.
 */
export function VideoCard({
  workspaceId,
  mediaId,
  width,
  height,
  alt,
  className,
}: {
  workspaceId: string;
  mediaId: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  alt?: string | undefined;
  className?: string;
}) {
  const api = useApi();
  const query = useMediaItem(workspaceId, mediaId);
  const item = query.data;
  const ratio = `${item?.width ?? width ?? 16} / ${item?.height ?? height ?? 9}`;
  const prompt = item?.prompt ?? alt ?? "";

  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="bg-ink/6 border-line relative overflow-hidden rounded-xl border"
        style={{ aspectRatio: ratio }}
      >
        {item?.status === "ready" ? (
          <Player workspaceId={workspaceId} item={{ id: mediaId, prompt }} />
        ) : item?.status === "failed" ? (
          <p
            role="alert"
            className="text-danger flex size-full items-center justify-center gap-2 px-4 text-center text-sm"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {item.error ?? "This video couldn't be made."}
          </p>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
            <span className="media-shimmer absolute inset-0" aria-hidden="true" />
            <span className="text-muted relative flex items-center gap-2 text-sm">
              <Clapperboard className="size-4" aria-hidden="true" />
              Making your video. It usually takes a minute or two.
            </span>
            <div
              role="progressbar"
              aria-label="Video progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item?.progress ?? 0}
              className="bg-ink/10 relative h-1.5 w-full max-w-60 overflow-hidden rounded-full"
            >
              <div
                className="bg-accent h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none"
                style={{ width: `${Math.max(4, item?.progress ?? 0)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {item?.status === "ready" ? (
        <figcaption className="text-muted flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate" title={prompt}>
            {prompt}
          </span>
          <button
            type="button"
            aria-label="Download video"
            onClick={() =>
              void saveVideo(api, workspaceId, mediaId).catch(() =>
                toast.error("The video couldn't be downloaded."),
              )
            }
            className="hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2"
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
        </figcaption>
      ) : null}
    </figure>
  );
}
