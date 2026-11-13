import type { AppFile } from "@tessel/contracts";

const REACT = "https://esm.sh/react@19.3.1";
const REACT_DOM = "https://esm.sh/react-dom@19.3.1";
const SUCRASE = "https://esm.sh/sucrase@3.35.1";

const json = (value: unknown) => JSON.stringify(value).replaceAll("</", "<\\/");
const isLocal = (url: string) => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(url);
const local = (url: string) => url.replace(/^\.?\//, "").replace(/[?#].*$/, "");

/** The app's pages: its HTML files, index first. */
export function appPages(files: AppFile[]): string[] {
  const pages = files.map((file) => file.path).filter((path) => /\.html?$/i.test(path));
  return pages.sort((a, b) =>
    a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b),
  );
}

/**
 * The loader that runs inside the frame: it compiles each module (Sucrase),
 * links relative imports between the app's files as blob URLs, injects
 * imported CSS, and loads npm packages from esm.sh sharing one React. It
 * runs inside the sandbox because blob URLs made by the app itself wouldn't
 * load in a frame with an opaque origin.
 */
const LOADER = String.raw`
const { transform } = await import("${SUCRASE}");
const files = window.__tesselFiles;
const urls = new Map();
const EXTENSIONS = ["", ".jsx", ".tsx", ".js", ".ts", ".mjs", "/index.jsx", "/index.tsx", "/index.js", "/index.ts"];
const normalize = (path) => {
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop(); else parts.push(part);
  }
  return parts.join("/");
};
const resolveLocal = (from, specifier) => {
  const base = specifier.startsWith("/") ? specifier : from.split("/").slice(0, -1).join("/") + "/" + specifier;
  const path = normalize(base);
  for (const extension of EXTENSIONS) if (files[path + extension] !== undefined) return path + extension;
  throw new Error("Can't find " + specifier + " (imported by " + from + ")");
};
const isBare = (specifier) => !/^(\.{0,2}\/|[a-z]+:)/i.test(specifier);
const isReact = (name) => name === "react" || name.startsWith("react/") || name === "react-dom" || name.startsWith("react-dom/");
const blob = (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" }));

async function load(path, stack = []) {
  if (urls.has(path)) return urls.get(path);
  if (stack.includes(path)) throw new Error("Circular import: " + [...stack, path].join(" → "));
  const source = files[path];
  let url;
  if (/\.css$/i.test(path)) {
    const style = document.createElement("style");
    style.dataset.file = path;
    style.textContent = source;
    document.head.append(style);
    url = blob("export default null;");
  } else if (/\.json$/i.test(path)) {
    url = blob("export default " + source + ";");
  } else if (/\.svg$/i.test(path)) {
    url = blob("export default " + JSON.stringify("data:image/svg+xml;charset=utf-8," + encodeURIComponent(source)) + ";");
  } else {
    let code = transform(source, { transforms: ["jsx", "typescript"], jsxRuntime: "automatic", production: true, filePath: path }).code;
    const pattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g;
    const replacements = [];
    for (const match of code.matchAll(pattern)) {
      const specifier = match[3];
      let target;
      if (isBare(specifier)) {
        target = isReact(specifier) ? specifier : "https://esm.sh/" + specifier + "?external=react,react-dom";
      } else if (/^[a-z]+:/i.test(specifier)) {
        target = specifier;
      } else {
        target = await load(resolveLocal(path, specifier), [...stack, path]);
      }
      replacements.push([match.index, match[0].length, match[1] + match[2] + target + match[2]]);
    }
    for (const [index, length, text] of replacements.reverse()) code = code.slice(0, index) + text + code.slice(index + length);
    url = blob(code);
  }
  urls.set(path, url);
  return url;
}

try {
  for (const entry of window.__tesselEntries) await import(await load(entry));
} catch (error) {
  window.__tesselReport(error && error.message || error);
  if (!document.body.childElementCount) document.body.textContent = "This app couldn't run: " + (error && error.message || error);
}
`;

/** Links to the app's other pages ask the panel to open them. */
const NAVIGATOR = String.raw`document.addEventListener("click", (event) => {
  const link = event.target.closest && event.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || /^(?:[a-z]+:|\/\/|#)/i.test(href)) return;
  const path = href.replace(/^\.?\//, "").replace(/[?#].*$/, "");
  if (window.__tesselFiles[path] === undefined || !/\.html?$/i.test(path)) return;
  event.preventDefault();
  parent.postMessage({ source: "tessel-artifact", kind: "navigate", page: path }, "*");
});
`;

/**
 * One page of an app as a document for the sandboxed frame: local
 * stylesheets and classic scripts are inlined, module scripts go through the
 * loader, and links to the app's other pages ask the panel to open them.
 */
export function appDocument(files: AppFile[], page: string, errorReporter: string): string {
  const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]));
  const html =
    byPath[page] ??
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>';
  const entries: string[] = [];

  let document = html
    // Local stylesheets, inlined.
    .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      if (!href || !isLocal(href) || byPath[local(href)] === undefined) return tag;
      return `<style data-file="${local(href)}">${byPath[local(href)]}</style>`;
    })
    // Module scripts load through the loader; classic local scripts are inlined.
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string, body: string) => {
      const src = /src=["']([^"']+)["']/i.exec(attrs)?.[1];
      const isModule = /type=["']?module/i.test(attrs);
      if (src && isLocal(src) && byPath[local(src)] !== undefined) {
        if (isModule) {
          entries.push(local(src));
          return "";
        }
        return `<script>${byPath[local(src)]?.replaceAll("</script", "<\\/script")}</script>`;
      }
      if (isModule && !src && body.trim()) {
        const path = `${page}.inline-${entries.length}.js`;
        byPath[path] = body;
        entries.push(path);
        return "";
      }
      return tag;
    });

  const head = `${errorReporter}
<script type="importmap">${json({ imports: { react: REACT, "react/": `${REACT}/`, "react-dom": REACT_DOM, "react-dom/": `${REACT_DOM}/` } })}</script>
<script>
window.__tesselFiles = ${json(byPath)};
window.__tesselEntries = ${json(entries)};
${NAVIGATOR}</script>
${entries.length ? `<script type="module">${LOADER}</script>` : ""}`;

  if (/<head[^>]*>/i.test(document)) {
    document = document.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`);
  } else if (/<html[^>]*>/i.test(document)) {
    document = document.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  } else {
    document = `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${document}</body></html>`;
  }
  return document;
}
