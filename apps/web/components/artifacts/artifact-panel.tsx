"use client";

import { artifactFilename, type ArtifactType, type ArtifactVersion } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import {
  Atom,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  FileText,
  Globe,
  Image as ImageIcon,
  RotateCw,
  TriangleAlert,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CopyButton, Markdown } from "@/components/chat/markdown";
import { useArtifactPanel } from "@/lib/artifact-store";
import { ArtifactFrame } from "./artifact-frame";

export const ARTIFACT_ICONS: Record<ArtifactType, LucideIcon> = {
  html: Globe,
  react: Atom,
  svg: ImageIcon,
  mermaid: Workflow,
  markdown: FileText,
  code: Code2,
};

const KIND_LABEL: Record<ArtifactType, string> = {
  html: "Web page",
  react: "Interactive component",
  svg: "Image",
  mermaid: "Diagram",
  markdown: "Document",
  code: "Code",
};

export function artifactKind(artifact: Pick<ArtifactVersion, "type" | "language">): string {
  return artifact.type === "code" && artifact.language
    ? `${KIND_LABEL.code} · ${artifact.language}`
    : KIND_LABEL[artifact.type];
}

/** Types with a rendered preview; code shows as code. */
const PREVIEWS = new Set<ArtifactType>(["html", "react", "svg", "mermaid", "markdown"]);
const RUNS = new Set<ArtifactType>(["html", "react", "svg", "mermaid"]);

const TOOL =
  "text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2 disabled:opacity-40";

function CodeView({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <div className="bg-paper size-full overflow-auto">
      <pre className="min-w-max py-3 text-[13px] leading-relaxed">
        {lines.map((line, index) => (
          <div key={index} className="flex">
            <span
              className="text-muted/70 w-12 shrink-0 pr-4 text-right tabular-nums select-none"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <code className="pr-6 whitespace-pre">{line || " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}

function download(artifact: ArtifactVersion) {
  const types: Partial<Record<ArtifactType, string>> = {
    html: "text/html",
    svg: "image/svg+xml",
    markdown: "text/markdown",
  };
  const url = URL.createObjectURL(
    new Blob([artifact.content], { type: types[artifact.type] ?? "text/plain" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = artifactFilename(artifact);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The open artifact beside the chat: its preview or code, its versions, and
 * copy and download. While it's being written the code shows as it streams.
 */
export function ArtifactPanel({ versions }: { versions: ArtifactVersion[] }) {
  const { version, view, setVersion, setView, close } = useArtifactPanel();
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onError = useCallback((message: string | null) => setError(message), []);

  const latest = versions.length;
  const shown = version && version <= latest ? version : latest;
  const artifact = versions[shown - 1];

  // Escape closes the panel when focus isn't in a field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "Escape" || target?.closest("input, textarea, [role=dialog]")) return;
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  if (!artifact) return null;
  const Icon = ARTIFACT_ICONS[artifact.type];
  const previewable = PREVIEWS.has(artifact.type);
  // While it streams, the code shows; a half-written page would only flicker.
  const showing = !artifact.complete || !previewable ? "code" : view;

  return (
    <section
      aria-label={`${artifact.title}, ${artifactKind(artifact)}`}
      className="bg-surface flex size-full min-h-0 flex-col"
    >
      <header className="border-line flex items-center gap-2 border-b px-3 py-2">
        <Icon className="text-accent size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{artifact.title}</h2>
          <p className="text-muted truncate text-xs">
            {artifact.complete ? artifactKind(artifact) : "Writing…"}
          </p>
        </div>
        {latest > 1 ? (
          <div className="text-muted flex items-center text-xs tabular-nums">
            <button
              type="button"
              className={TOOL}
              aria-label="Previous version"
              disabled={shown <= 1}
              onClick={() => setVersion(shown - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <span aria-live="polite">
              Version {shown} of {latest}
            </span>
            <button
              type="button"
              className={TOOL}
              aria-label="Next version"
              disabled={shown >= latest}
              onClick={() => setVersion(shown + 1 >= latest ? null : shown + 1)}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <button type="button" className={TOOL} aria-label="Close artifact" onClick={close}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="border-line flex items-center gap-1 border-b px-3 py-1.5">
        {previewable ? (
          <div role="tablist" aria-label="Show" className="bg-paper flex rounded-lg p-0.5 text-sm">
            {(["preview", "code"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={showing === option}
                disabled={!artifact.complete}
                onClick={() => setView(option)}
                className={cn(
                  "focus-visible:outline-accent rounded-md px-3 py-1 font-medium capitalize focus-visible:outline-2",
                  showing === option ? "bg-surface text-ink shadow-sm" : "text-muted",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {RUNS.has(artifact.type) && showing === "preview" ? (
            <button
              type="button"
              className={TOOL}
              aria-label="Run again"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RotateCw className="size-4" aria-hidden="true" />
            </button>
          ) : null}
          <CopyButton text={artifact.content} label="Copy artifact" />
          <button
            type="button"
            className={TOOL}
            aria-label="Download"
            disabled={!artifact.complete}
            onClick={() => download(artifact)}
          >
            <Download className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && showing === "preview" ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger/6 text-danger flex items-start gap-2 border-b px-3 py-2 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">
            This artifact hit an error: {error}. Ask Tessel to fix it.
          </span>
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {showing === "code" ? (
          <CodeView code={artifact.content} />
        ) : artifact.type === "markdown" ? (
          <div className="size-full overflow-y-auto px-6 py-5">
            <Markdown text={artifact.content} sources={[]} />
          </div>
        ) : (
          <ArtifactFrame
            type={artifact.type}
            content={artifact.content}
            title={artifact.title}
            reloadKey={reloadKey}
            onError={onError}
          />
        )}
      </div>
    </section>
  );
}
