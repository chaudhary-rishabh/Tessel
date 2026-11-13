"use client";

import { ApiClientError } from "@tessel/api-client";
import { queryKeys, useApi } from "@tessel/api-client/react";
import {
  DOCUMENT_TYPES,
  MAX_RECORDING_BYTES,
  maxUploadBytes,
  type DocumentSummary,
} from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Upload, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { formatBytes } from "./document-list";

interface Uploading {
  id: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
}

const ACCEPT = Object.keys(DOCUMENT_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

/**
 * Big uploads in progress, by file, so picking the same file again after a
 * dropped connection or a reload carries on instead of starting over.
 */
const resumeKey = (workspaceId: string, file: File) =>
  `tessel.upload.${workspaceId}.${file.name}.${file.size}.${file.lastModified}`;
const remembered = {
  get(key: string) {
    try {
      return window.localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(key: string, documentId: string) {
    try {
      window.localStorage.setItem(key, documentId);
    } catch {
      // Without storage, an interrupted upload starts over.
    }
  },
  forget(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to forget.
    }
  },
};

function validate(file: File): string | undefined {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!file.name.includes(".") || !Object.hasOwn(DOCUMENT_TYPES, extension)) {
    return "Upload a PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, or HTML file, or an audio or video recording";
  }
  if (file.size === 0) return "The file is empty";
  const max = maxUploadBytes(file.name);
  if (file.size > max) {
    return max === MAX_RECORDING_BYTES
      ? "Recordings can be up to 500 MB"
      : "Files can be up to 50 MB";
  }
  return undefined;
}

export function UploadZone({ workspaceId }: { workspaceId: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<Uploading[]>([]);

  const update = (id: string, patch: Partial<Uploading>) =>
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  function start(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      const problem = validate(file);
      setUploads((current) => [
        ...current,
        {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          ...(problem ? { error: problem } : {}),
        },
      ]);
      if (problem) continue;
      const key = resumeKey(workspaceId, file);
      const resume = remembered.get(key);
      api.documents
        .upload(workspaceId, file, (progress) => update(id, { progress }), {
          ...(resume ? { resume } : {}),
          onStart: (documentId) => remembered.set(key, documentId),
        })
        .then((document) => {
          remembered.forget(key);
          queryClient.setQueryData<DocumentSummary[]>(
            queryKeys.documents(workspaceId),
            (current = []) => [document, ...current.filter((item) => item.id !== document.id)],
          );
          void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspaceId) });
          setUploads((current) => current.filter((item) => item.id !== id));
        })
        .catch((error: unknown) =>
          update(id, {
            error:
              (error instanceof ApiClientError ? error.message : "The file couldn't be uploaded") +
              (remembered.get(key) ? " Add the same file again to carry on where it stopped." : ""),
          }),
        );
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) start(event.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "border-line flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging && "border-accent bg-accent/5",
        )}
      >
        <Upload className="text-muted size-6" aria-hidden="true" />
        <div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-describedby={hintId}
            className="text-accent focus-visible:outline-accent rounded font-medium underline-offset-2 hover:underline focus-visible:outline-2"
          >
            Choose files
          </button>
          <span className="text-muted"> or drop them here</span>
        </div>
        <p id={hintId} className="text-muted text-sm">
          PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, or HTML, up to 50 MB each. Audio
          and video recordings, up to 500 MB, are transcribed.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          data-testid="document-input"
          onChange={(event) => {
            if (event.target.files) start(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {uploads.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Uploads">
          {uploads.map((item) => (
            <li
              key={item.id}
              className="border-line flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                {item.error ? (
                  <p className="text-danger flex items-center gap-1.5">
                    <CircleAlert className="size-3.5" aria-hidden="true" />
                    {item.error}
                  </p>
                ) : (
                  <div
                    role="progressbar"
                    aria-label={`Uploading ${item.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(item.progress * 100)}
                    className="bg-line mt-1.5 h-1.5 overflow-hidden rounded-full"
                  >
                    <div
                      className="bg-accent h-full transition-[width]"
                      style={{ width: `${item.progress * 100}%` }}
                    />
                  </div>
                )}
              </div>
              <span className="text-muted tabular-nums">{formatBytes(item.size)}</span>
              {item.error ? (
                <button
                  type="button"
                  aria-label={`Dismiss ${item.name}`}
                  onClick={() =>
                    setUploads((current) => current.filter((upload) => upload.id !== item.id))
                  }
                  className="text-muted hover:text-ink flex size-8 items-center justify-center rounded-md"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
