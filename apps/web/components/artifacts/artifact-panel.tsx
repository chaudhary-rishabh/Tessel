"use client";

import {
  artifactFilename,
  parseAppFiles,
  type AppFile,
  type ArtifactType,
  type ArtifactVersion,
} from "@tessel/contracts";
import { cn } from "@tessel/ui";
import {
  AppWindow,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton, Markdown } from "@/components/chat/markdown";
import { useArtifactPanel } from "@/lib/artifact-store";
import { appPages } from "./app-runtime";
import { ArtifactFrame } from "./artifact-frame";

export const ARTIFACT_ICONS: Record<ArtifactType, LucideIcon> = {
  html: Globe,
  react: Atom,
  svg: ImageIcon,
  mermaid: Workflow,
  markdown: FileText,
  code: Code2,
  app: AppWindow,
};

const KIND_LABEL: Record<ArtifactType, string> = {
  html: "Web page",
  react: "Interactive component",
  svg: "Image",
  mermaid: "Diagram",
  markdown: "Document",
  code: "Code",
  app: "App",
};

export function artifactKind(artifact: Pick<ArtifactVersion, "type" | "language">): string {
  return artifact.type === "code" && artifact.language
    ? `${KIND_LABEL.code} · ${artifact.language}`
    : KIND_LABEL[artifact.type];
}

/** Types with a rendered preview; code shows as code. */
const PREVIEWS = new Set<ArtifactType>(["html", "react", "svg", "mermaid", "markdown", "app"]);
const RUNS = new Set<ArtifactType>(["html", "react", "svg", "mermaid", "app"]);

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

/** An app's files, one listed and shown at a time. */
function AppCode({ files }: { files: AppFile[] }) {
  const [picked, setPicked] = useState<string>();
  // While the app is written, follow the file being written.
  const writing = files.find((file) => !file.complete)?.path;
  const path =
    writing ?? (picked && files.some((file) => file.path === picked) ? picked : files[0]?.path);
  const file = files.find((item) => item.path === path);
  return (
    <div className="flex size-full min-h-0 flex-col sm:flex-row">
      <nav
        aria-label="Files"
        className="border-line bg-surface shrink-0 overflow-auto border-b text-sm sm:w-52 sm:border-r sm:border-b-0"
      >
        <ul className="flex gap-0.5 p-1.5 sm:flex-col">
          {files.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => setPicked(item.path)}
                aria-current={item.path === path ? "true" : undefined}
                className={cn(
                  "focus-visible:outline-accent w-full truncate rounded-md px-2 py-1 text-left whitespace-nowrap focus-visible:outline-2",
                  item.path === path
                    ? "bg-accent/10 text-ink font-medium"
                    : "text-muted hover:bg-ink/6",
                )}
              >
                {item.path}
                {!item.complete ? " …" : ""}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-h-0 flex-1">{file ? <CodeView code={file.content} /> : null}</div>
    </div>
  );
}

async function downloadApp(artifact: ArtifactVersion) {
  const { strToU8, zipSync } = await import("fflate");
  const files = parseAppFiles(artifact.content);
  const zipped = zipSync(
    Object.fromEntries(files.map((file) => [file.path, strToU8(file.content)])),
  );
  save(new Blob([zipped], { type: "application/zip" }), artifactFilename(artifact));
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function download(artifact: ArtifactVersion) {
  if (artifact.type === "app") {
    void downloadApp(artifact);
    return;
  }
  const types: Partial<Record<ArtifactType, string>> = {
    html: "text/html",
    svg: "image/svg+xml",
    markdown: "text/markdown",
  };
  save(
    new Blob([artifact.content], { type: types[artifact.type] ?? "text/plain" }),
    artifactFilename(artifact),
  );
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
  const [page, setPage] = useState("index.html");

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

  const appType = artifact?.type;
  const appContent = artifact?.content;
  const appFiles = useMemo(
    () => (appType === "app" && appContent ? parseAppFiles(appContent) : []),
    [appType, appContent],
  );
  const pages = useMemo(() => appPages(appFiles), [appFiles]);
  const shownPage = pages.includes(page) ? page : (pages[0] ?? "index.html");

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
          {artifact.type === "app" && pages.length > 1 && showing === "preview" ? (
            <select
              aria-label="Page"
              value={shownPage}
              onChange={(event) => setPage(event.target.value)}
              className="border-line bg-surface mr-1 h-8 max-w-40 rounded-md border px-1.5 text-sm"
            >
              {pages.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : null}
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
          artifact.type === "app" ? (
            <AppCode files={appFiles} />
          ) : (
            <CodeView code={artifact.content} />
          )
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
            page={artifact.type === "app" ? shownPage : undefined}
            onNavigate={setPage}
            onError={onError}
          />
        )}
      </div>
    </section>
  );
}
