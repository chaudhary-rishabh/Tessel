"use client";

import { useApi } from "@tessel/api-client/react";
import type { MessageSource } from "@tessel/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@tessel/ui";
import { ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";

const where = (source: MessageSource) =>
  source.page ? `${source.filename}, page ${source.page}` : source.filename;

/** Opens the original document through a short-lived download link. */
function OpenDocumentButton({ source }: { source: MessageSource }) {
  const api = useApi();
  const { current } = useCurrentWorkspace();
  const [failed, setFailed] = useState(false);
  if (!current) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          window.open(
            await api.documents.downloadUrl(current.id, source.documentId),
            "_blank",
            "noopener",
          );
        } catch {
          setFailed(true);
        }
      }}
      className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded text-sm font-medium hover:underline focus-visible:outline-2"
    >
      {failed ? "Document unavailable" : "Open document"}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </button>
  );
}

function SourceDetails({ source }: { source: MessageSource }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2 text-sm font-medium">
        <FileText className="text-muted mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {where(source)}
      </p>
      <blockquote className="border-line text-muted line-clamp-[8] border-l-2 pl-3 text-sm whitespace-pre-line">
        {source.text}
      </blockquote>
      <OpenDocumentButton source={source} />
    </div>
  );
}

/** An inline [n] citation: a small numbered chip that shows the passage it points to. */
export function CitationChip({ source }: { source: MessageSource }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Source ${source.id}: ${where(source)}`}
        className="bg-accent/12 text-accent hover:bg-accent/20 focus-visible:outline-accent mx-0.5 inline-flex h-5 min-w-5 -translate-y-0.5 items-center justify-center rounded-md px-1 align-middle text-xs font-semibold tabular-nums focus-visible:outline-2"
      >
        {source.id}
      </PopoverTrigger>
      <PopoverContent>
        <SourceDetails source={source} />
      </PopoverContent>
    </Popover>
  );
}

/** The documents a reply cites, listed under it. */
export function SourceList({ sources }: { sources: MessageSource[] }) {
  const cited = sources.filter((source) => source.cited);
  if (cited.length === 0) return null;
  return (
    <div className="mt-1">
      <p className="text-muted text-xs font-medium">Sources</p>
      <ol className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Sources">
        {cited.map((source) => (
          <li key={source.id}>
            <Popover>
              <PopoverTrigger className="border-line hover:bg-ink/4 focus-visible:outline-accent flex max-w-64 items-center gap-1.5 rounded-lg border py-1 pr-2.5 pl-1.5 text-xs focus-visible:outline-2">
                <span className="bg-accent/12 text-accent flex size-5 items-center justify-center rounded font-semibold tabular-nums">
                  {source.id}
                </span>
                <span className="truncate">{where(source)}</span>
              </PopoverTrigger>
              <PopoverContent>
                <SourceDetails source={source} />
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Turns [n] markers that match a source into links the Markdown renderer
 * shows as citation chips. Code blocks are left alone.
 */
export function linkCitations(text: string, sources: MessageSource[]): string {
  if (sources.length === 0) return text;
  const ids = new Set(sources.map((source) => source.id));
  return text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/\[(\d{1,2})\](?!\()/g, (marker, id: string) =>
            ids.has(Number(id)) ? `[${id}](#source-${id})` : marker,
          ),
    )
    .join("");
}
