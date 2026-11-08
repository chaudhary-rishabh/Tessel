"use client";

import { useApi } from "@tessel/api-client/react";
import type { Attachment } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { useQuery } from "@tanstack/react-query";
import { FileText, X } from "lucide-react";
import { useEffect, useMemo } from "react";

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** An object URL for an attachment's image, fetched with the user's token. */
function useImageUrl(workspaceId: string, attachment: Attachment, localUrl?: string) {
  const api = useApi();
  const blob = useQuery({
    queryKey: ["attachment", attachment.id],
    queryFn: () => api.chat.attachmentBlob(workspaceId, attachment.id),
    enabled: attachment.kind === "image" && !localUrl,
    staleTime: Infinity,
  });
  const url = useMemo(() => (blob.data ? URL.createObjectURL(blob.data) : undefined), [blob.data]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return localUrl ?? url;
}

export function AttachmentChip({
  workspaceId,
  attachment,
  localUrl,
  uploading,
  progress,
  error,
  onRemove,
}: {
  workspaceId: string;
  attachment: Attachment;
  /** A preview of a file that is still uploading. */
  localUrl?: string;
  uploading?: boolean;
  progress?: number;
  error?: string;
  onRemove?: () => void;
}) {
  const imageUrl = useImageUrl(workspaceId, attachment, localUrl);
  return (
    <div
      className={cn(
        "border-line bg-surface relative flex h-14 max-w-56 items-center gap-2.5 rounded-xl border pr-2 pl-1.5",
        error && "border-danger",
      )}
    >
      {attachment.kind === "image" ? (
        <div className="bg-paper size-11 shrink-0 overflow-hidden rounded-lg">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URLs can't go through next/image
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : null}
        </div>
      ) : (
        <div className="bg-paper text-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
          <FileText className="size-5" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{attachment.filename}</p>
        <p className={cn("text-xs", error ? "text-danger" : "text-muted")}>
          {error ??
            (uploading
              ? `Uploading ${Math.round((progress ?? 0) * 100)}%`
              : formatSize(attachment.sizeBytes))}
        </p>
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.filename}`}
          className="bg-ink text-paper focus-visible:outline-accent absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full focus-visible:outline-2"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
