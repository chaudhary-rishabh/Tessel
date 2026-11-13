"use client";

import { parseAppFiles, type ArtifactType } from "@tessel/contracts";
import { appDocument } from "./app-runtime";
import { useEffect, useMemo, useRef } from "react";

const REACT = "https://esm.sh/react@19.3.1";
const REACT_DOM = "https://esm.sh/react-dom@19.3.1";
const SUCRASE = "https://esm.sh/sucrase@3.35.1";
const MERMAID = "https://esm.sh/mermaid@12.2.0";
const TAILWIND = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3";

/** Tells the app about errors inside the frame, so it can say the artifact broke. */
const ERROR_REPORTER = `<script>
(() => {
  const report = (message) => parent.postMessage({ source: "tessel-artifact", kind: "error", message: String(message).slice(0, 500) }, "*");
  addEventListener("error", (event) => report(event.message || "Script error"));
  addEventListener("unhandledrejection", (event) => report(event.reason && event.reason.message || event.reason));
  window.__tesselReport = report;
})();
</script>`;

const json = (value: unknown) => JSON.stringify(value).replaceAll("</", "<\\/");

function htmlDocument(content: string): string {
  const page = /<html[\s>]/i.test(content)
    ? content
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
  // The reporter goes first, so it hears errors from every script after it.
  return /<head[^>]*>/i.test(page)
    ? page.replace(/<head[^>]*>/i, (head) => `${head}${ERROR_REPORTER}`)
    : `${ERROR_REPORTER}${page}`;
}

function svgDocument(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${ERROR_REPORTER}<style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh;height:auto}</style></head><body>${content}</body></html>`;
}

function mermaidDocument(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${ERROR_REPORTER}<style>body{margin:0;padding:24px;display:flex;justify-content:center;background:#fff;font-family:system-ui,sans-serif}svg{max-width:100%;height:auto}</style></head><body><div id="diagram">Drawing…</div>
<script type="module">
import mermaid from "${MERMAID}";
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
try {
  const { svg } = await mermaid.render("tessel-diagram", ${json(content)});
  document.getElementById("diagram").innerHTML = svg;
} catch (error) {
  document.getElementById("diagram").textContent = "This diagram has an error.";
  window.__tesselReport(error && error.message || error);
}
</script></body></html>`;
}

/**
 * A React component as a page: the code is compiled in the frame (Sucrase),
 * bare imports come from esm.sh sharing one React, Tailwind classes work, and
 * the default export renders full size.
 */
function reactDocument(content: string): string {
  const importMap = {
    imports: {
      react: REACT,
      "react/": `${REACT}/`,
      "react-dom": REACT_DOM,
      "react-dom/": `${REACT_DOM}/`,
    },
  };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${ERROR_REPORTER}
<script type="importmap">${json(importMap)}</script>
<script src="${TAILWIND}"></script>
<style>html,body,#root{min-height:100%;margin:0}</style>
</head><body><div id="root"></div>
<script type="module">
import { transform } from "${SUCRASE}";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
const source = ${json(content)};
try {
  let code = transform(source, { transforms: ["jsx", "typescript"], jsxRuntime: "automatic", production: true }).code;
  // Packages other than React load from esm.sh, sharing this page's React.
  code = code.replace(/(from\\s+|import\\s*\\(?\\s*)(["'])([^"'./][^"']*)\\2/g, (whole, prefix, quote, name) =>
    name === "react" || name.startsWith("react/") || name === "react-dom" || name.startsWith("react-dom/")
      ? whole
      : prefix + quote + "https://esm.sh/" + name + "?external=react,react-dom" + quote);
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const module = await import(url);
  const Component = module.default ?? Object.values(module).find((value) => typeof value === "function");
  if (!Component) throw new Error("The component has no default export.");
  createRoot(document.getElementById("root")).render(createElement(Component));
} catch (error) {
  document.getElementById("root").textContent = "This component couldn't run.";
  window.__tesselReport(error && error.message || error);
}
</script></body></html>`;
}

export function artifactDocument(
  type: ArtifactType,
  content: string,
  page = "index.html",
): string | null {
  switch (type) {
    case "app":
      return appDocument(parseAppFiles(content), page, ERROR_REPORTER);
    case "html":
      return htmlDocument(content);
    case "svg":
      return svgDocument(content);
    case "mermaid":
      return mermaidDocument(content);
    case "react":
      return reactDocument(content);
    default:
      return null;
  }
}

/**
 * Runs an artifact in a sandboxed frame: scripts run, but in an opaque
 * origin, so the artifact can't reach the app, its storage, or the signed-in
 * session. Errors inside are reported back.
 */
export function ArtifactFrame({
  type,
  content,
  title,
  reloadKey = 0,
  page,
  onNavigate,
  onError,
}: {
  type: ArtifactType;
  content: string;
  title: string;
  /** Changing it runs the artifact again from the start. */
  reloadKey?: number;
  /** An app's page to show. */
  page?: string | undefined;
  /** An app's link to another of its pages was clicked. */
  onNavigate?: ((page: string) => void) | undefined;
  onError?: (message: string | null) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const document = useMemo(() => artifactDocument(type, content, page), [type, content, page]);

  useEffect(() => {
    onError?.(null);
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as {
        source?: string;
        kind?: string;
        message?: string;
        page?: string;
      };
      if (data?.source !== "tessel-artifact") return;
      if (data.kind === "error") onError?.(data.message ?? "");
      if (data.kind === "navigate" && typeof data.page === "string") onNavigate?.(data.page);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [document, reloadKey, onError, onNavigate]);

  if (!document) return null;
  return (
    <iframe
      key={reloadKey}
      ref={frame}
      title={title}
      srcDoc={document}
      // No allow-same-origin: the frame gets an opaque origin of its own.
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
      className="size-full border-0 bg-white"
    />
  );
}
