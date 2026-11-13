"use client";

import { useApi, useMediaActions, useMediaItem } from "@tessel/api-client/react";
import { Button, Takeover, cn } from "@tessel/ui";
import { Download, MessageSquare, PenLine, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "@/lib/toast-store";
import { MediaImage } from "./media-image";

const TOOL =
  "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40";

export interface ViewedImage {
  id: string;
  width?: number | null | undefined;
  height?: number | null | undefined;
  alt?: string | undefined;
}

async function saveImage(api: ReturnType<typeof useApi>, workspaceId: string, id: string) {
  const blob = await api.media.blob(workspaceId, id, "original");
  const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tessel-image-${id.slice(0, 8)}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One image, full screen: its prompt, download, and either "Edit in chat"
 * (from a reply) or an edit box and delete (in the gallery).
 */
export function ImageViewer({
  workspaceId,
  image,
  onClose,
  onEditInChat,
  editHere = false,
  onDeleted,
  onChange,
}: {
  workspaceId: string;
  image: ViewedImage;
  onClose: () => void;
  /** Points the composer at this image, for an edit in the chat. */
  onEditInChat?: (() => void) | undefined;
  /** Offers an edit box here, which makes a new image (the gallery). */
  editHere?: boolean;
  onDeleted?: (() => void) | undefined;
  /** An edit made here becomes the image shown. */
  onChange?: ((image: ViewedImage) => void) | undefined;
}) {
  const api = useApi();
  const item = useMediaItem(workspaceId, image.id);
  const actions = useMediaActions(workspaceId);
  const [change, setChange] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const width = item.data?.width ?? image.width;
  const height = item.data?.height ?? image.height;
  const prompt = item.data?.prompt ?? image.alt ?? "";
  const editing = actions.generateImage.isPending;

  async function edit() {
    const text = change.trim();
    if (!text) return;
    try {
      const made = await actions.generateImage.mutateAsync({ prompt: text, sourceIds: [image.id] });
      setChange("");
      onChange?.({ id: made.id, width: made.width, height: made.height, alt: made.prompt });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image couldn't be edited.");
    }
  }

  return (
    <Takeover label="Image" onClose={onClose} className="bg-neutral-950 text-white">
      <header className="flex items-center gap-1 px-3 py-2 sm:px-4">
        <button
          type="button"
          className={cn(TOOL, "px-2")}
          aria-label="Close image"
          onClick={onClose}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
          {onEditInChat ? (
            <button type="button" className={TOOL} onClick={onEditInChat}>
              <PenLine className="size-4" aria-hidden="true" />
              Edit in chat
            </button>
          ) : null}
          {item.data?.threadId && editHere ? (
            <Link href={`/chat/${item.data.threadId}`} className={TOOL}>
              <MessageSquare className="size-4" aria-hidden="true" />
              <span className="max-sm:sr-only">Open chat</span>
            </Link>
          ) : null}
          <button
            type="button"
            className={TOOL}
            onClick={() =>
              void saveImage(api, workspaceId, image.id).catch(() =>
                toast.error("The image couldn't be downloaded."),
              )
            }
          >
            <Download className="size-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Download</span>
          </button>
          {onDeleted ? (
            confirmDelete ? (
              <button
                type="button"
                className={cn(TOOL, "bg-red-500/20 text-red-100 hover:bg-red-500/30")}
                disabled={actions.remove.isPending}
                onClick={() =>
                  actions.remove.mutate(image.id, {
                    onSuccess: onDeleted,
                    onError: () => toast.error("The image couldn't be deleted."),
                  })
                }
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete for good
              </button>
            ) : (
              <button type="button" className={TOOL} onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="max-sm:sr-only">Delete</span>
              </button>
            )
          ) : null}
        </div>
      </header>

      {/* The image fills the space it has, at its own shape. */}
      <div className="min-h-0 flex-1 px-3 pb-3 sm:px-8">
        <MediaImage
          key={image.id}
          workspaceId={workspaceId}
          mediaId={image.id}
          alt={prompt}
          width={width}
          height={height}
          variant="original"
          fit="contain"
          className={cn("size-full bg-transparent", editing && "opacity-60 transition-opacity")}
        />
      </div>

      <footer className="mx-auto w-full max-w-2xl px-4 pb-4">
        {prompt ? (
          <p className="line-clamp-3 text-center text-sm text-white/70" title={prompt}>
            {prompt}
          </p>
        ) : null}
        {editHere ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void edit();
            }}
          >
            <label htmlFor="image-change" className="sr-only">
              Change to make
            </label>
            <input
              id="image-change"
              value={change}
              onChange={(event) => setChange(event.target.value)}
              placeholder="Describe a change, like “make it night”"
              disabled={editing}
              className="h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/8 px-3 text-sm text-white placeholder:text-white/45 focus:border-white/40 focus:outline-none"
            />
            <Button type="submit" disabled={!change.trim() || editing}>
              {editing ? "Editing…" : "Edit"}
            </Button>
          </form>
        ) : null}
      </footer>
    </Takeover>
  );
}
