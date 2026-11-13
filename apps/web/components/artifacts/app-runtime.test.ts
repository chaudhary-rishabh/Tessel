import { parseAppFiles } from "@tessel/contracts";
import { describe, expect, it } from "vitest";
import { appDocument, appPages } from "./app-runtime";

const file = (path: string, content: string) => `<file path="${path}">\n${content}\n</file>\n`;
const files = parseAppFiles(
  file(
    "index.html",
    '<html><head><link rel="stylesheet" href="./styles.css"><link rel="stylesheet" href="https://example.com/x.css"></head>' +
      '<body><script src="legacy.js"></script><script type="module" src="/src/main.jsx"></script></body></html>',
  ) +
    file("about.html", "<h1>About</h1>") +
    file("styles.css", "body { color: red; }") +
    file("legacy.js", 'window.legacy = "</script>";') +
    file("src/main.jsx", "console.log(1);"),
);

describe("appPages", () => {
  it("lists the HTML files, index first", () => {
    expect(appPages(files)).toEqual(["index.html", "about.html"]);
  });
});

describe("appDocument", () => {
  const document = appDocument(files, "index.html", "<script>/* reporter */</script>");

  it("inlines local stylesheets and classic scripts and leaves remote ones", () => {
    expect(document).toContain('<style data-file="styles.css">body { color: red; }</style>');
    expect(document).toContain('href="https://example.com/x.css"');
    expect(document).toContain('window.legacy = "<\\/script>";');
  });

  it("loads module scripts through the loader", () => {
    expect(document).not.toContain('src="/src/main.jsx"');
    expect(document).toContain('window.__tesselEntries = ["src/main.jsx"]');
    expect(document).toContain("https://esm.sh/sucrase@");
  });

  it("puts the reporter first and keeps the scripts it adds valid", () => {
    expect(document.indexOf("/* reporter */")).toBeLessThan(document.indexOf("__tesselFiles"));
    // Every inline script the runtime adds must parse as JavaScript.
    const scripts = [...document.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]!)
      .filter((code) => code.includes("__tessel"));
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const code of scripts) {
      expect(
        () => new Function(`return async () => {${code.replace(/\bimport\(/g, "(")}}`),
      ).not.toThrow();
    }
  });

  it("wraps a page without a head", () => {
    const about = appDocument(files, "about.html", "");
    expect(about).toMatch(/^<!doctype html><html><head>/);
    expect(about).toContain("<h1>About</h1>");
  });
});
