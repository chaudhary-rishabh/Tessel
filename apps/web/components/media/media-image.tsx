"use client";

import { useMediaUrl } from "@tessel/api-client/react";
import { cn } from "@tessel/ui";
import { ImageOff } from "lucide-react";
import { useState } from "react";

/**
 * A generated image, fetched with the user's token. Until it loads, a
 * placeholder of the same shape holds its place, so nothing jumps.
 */
export function MediaImage({
  workspaceId,
  mediaId,
  alt,
  width,
  height,
  variant = "preview",
  className,
  fit = "cover",
}: {
  workspaceId: string;
  mediaId: string;
  alt: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  variant?: "original" | "preview";
  className?: string;
  fit?: "cover" | "contain";
}) {
  const { url, isError } = useMediaUrl(workspaceId, mediaId, variant);
  const [loaded, setLoaded] = useState(false);
  const ratio = width && height ? `${width} / ${height}` : "1 / 1";
  return (
    <span
      className={cn("bg-ink/6 relative block overflow-hidden", className)}
      style={{ aspectRatio: ratio }}
    >
      {!loaded && !isError ? (
        <span className="media-shimmer absolute inset-0" aria-hidden="true" />
      ) : null}
      {isError ? (
        <span className="text-muted absolute inset-0 flex items-center justify-center">
          <ImageOff className="size-6" aria-hidden="true" />
          <span className="sr-only">This image couldn&apos;t load</span>
        </span>
      ) : null}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- an object URL, not a static asset
        <img
          src={url}
          alt={alt}
          onLoad={() => setLoaded(true)}
          className={cn(
            "size-full transition-opacity duration-300 motion-reduce:transition-none",
            fit === "cover" ? "object-cover" : "object-contain",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}
