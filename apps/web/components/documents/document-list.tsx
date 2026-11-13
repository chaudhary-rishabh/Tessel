"use client";

import { toApiClientError } from "@tessel/api-client";

import { useApi, useDeleteDocument, useReprocessDocument } from "@tessel/api-client/react";
import { isRecording, type DocumentSummary } from "@tessel/contracts";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
} from "@tessel/ui";
import {
  AudioLines,
  CircleAlert,
  Download,
  Ellipsis,
  FileText,
  RotateCw,
  Trash2,
  Video,
} from "lucide-react";
import { useState } from "react";
import { FormError } from "@/components/form-error";
import { documentErrorMessage } from "@/lib/document-errors";
import { toast } from "@/lib/toast-store";

export const formatBytes = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function Status({ document }: { document: DocumentSummary }) {
  switch (document.status) {
    case "ready": {
      const parts = [
        document.pageCount
          ? `${document.pageCount} page${document.pageCount === 1 ? "" : "s"}`
          : null,
        `${document.chunkCount ?? 0} passage${document.chunkCount === 1 ? "" : "s"}`,
      ].filter(Boolean);
      return <span className="text-muted">Ready, {parts.join(", ")}</span>;
    }
    case "failed":
      return (
        <span className="text-danger flex items-start gap-1.5">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {documentErrorMessage(document.errorCode)}
        </span>
      );
    default:
      return (
        <span className="text-muted flex items-center gap-1.5">
          <Spinner className="size-3.5" label="" />
          {document.status === "processing"
            ? isRecording(document.mediaType)
              ? "Transcribing"
              : "Indexing"
            : document.status === "queued"
              ? "Waiting to index"
              : "Uploading"}
        </span>
      );
  }
}

export function DocumentList({
  workspaceId,
  documents,
  canManage,
}: {
  workspaceId: string;
  documents: DocumentSummary[];
  canManage: (document: DocumentSummary) => boolean;
}) {
  const api = useApi();
  const remove = useDeleteDocument(workspaceId);
  const reprocess = useReprocessDocument(workspaceId);
  const [deleting, setDeleting] = useState<DocumentSummary>();

  async function download(document: DocumentSummary) {
    try {
      window.location.assign(await api.documents.downloadUrl(workspaceId, document.id));
    } catch (error) {
      toast.error(toApiClientError(error).message);
    }
  }

  return (
    <>
      <ul className="divide-line border-line divide-y border-y" aria-label="Documents">
        {documents.map((document) => (
          <li key={document.id} className="flex items-start gap-3 py-3.5">
            <div className="bg-paper text-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
              {document.mediaType.startsWith("video/") ? (
                <Video className="size-5" aria-hidden="true" />
              ) : document.mediaType.startsWith("audio/") ? (
                <AudioLines className="size-5" aria-hidden="true" />
              ) : (
                <FileText className="size-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{document.filename}</p>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="text-muted tabular-nums">{formatBytes(document.sizeBytes)}</span>
                <Status document={document} />
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Options for ${document.filename}`}
                className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent flex size-10 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem
                  disabled={document.status === "uploading"}
                  onSelect={() => void download(document)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Download
                </DropdownMenuItem>
                {canManage(document) &&
                (document.status === "failed" || document.status === "ready") ? (
                  <DropdownMenuItem onSelect={() => reprocess.mutate(document.id)}>
                    <RotateCw className="size-4" aria-hidden="true" />
                    {document.status === "failed" ? "Try again" : "Index again"}
                  </DropdownMenuItem>
                ) : null}
                {canManage(document) ? (
                  <DropdownMenuItem className="text-danger" onSelect={() => setDeleting(document)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      {deleting ? (
        <Dialog open onOpenChange={(open) => !open && setDeleting(undefined)}>
          <DialogContent
            title="Delete document?"
            description={`"${deleting.filename}" will be removed from the workspace and from search.`}
          >
            <FormError message={remove.error?.message} />
            <div className={cn("flex justify-end gap-2", remove.error && "mt-4")}>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutateAsync(deleting.id).then(
                    () => setDeleting(undefined),
                    () => undefined,
                  )
                }
              >
                Delete document
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
