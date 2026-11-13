/**
 * Artifacts: substantial, self-contained pieces of work in a reply (a page,
 * a component, a diagram, a document, a long piece of code) that open in a
 * side panel instead of filling the conversation. The model writes them
 * inline as
 *
 *   <artifact id="landing-page" type="html" title="Landing page">…</artifact>
 *
 * so they stream as they're written. Writing the same id again later in the
 * chat makes a new version; the versions are the chat's own messages, so
 * editing or retrying a message changes them the same way it changes the chat.
 */

export const ARTIFACT_TYPES = ["html", "react", "svg", "mermaid", "markdown", "code"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface ArtifactBlock {
  kind: "artifact";
  identifier: string;
  type: ArtifactType;
  title: string;
  /** The language of a code artifact, like "python". */
  language: string | null;
  content: string;
  /** False while the closing tag hasn't streamed in yet. */
  complete: boolean;
}

export type MessageSegment = { kind: "text"; text: string } | ArtifactBlock;

const OPEN = /<artifact\b([^>]*)>/g;
const CLOSE = "</artifact>";

function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) {
    found[match[1]!.toLowerCase()] = match[2]!;
  }
  return found;
}

/** Content without one fence around it all, which models sometimes add. */
function unfenced(content: string): string {
  const trimmed = content.replace(/^\n+/, "").replace(/\s+$/, "");
  const fenced = /^```[\w+-]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced ? fenced[1]! : trimmed;
}

/** Text that ends partway through an opening tag still being streamed. */
function withoutPartialTag(text: string): string {
  const start = text.lastIndexOf("<");
  if (start === -1) return text;
  const tail = text.slice(start);
  if (tail.includes(">")) return text;
  return "<artifact".startsWith(tail) || tail.startsWith("<artifact") ? text.slice(0, start) : text;
}

/**
 * Splits a reply into text and artifacts, in order. Works on a reply that's
 * still streaming: an artifact without its closing tag is incomplete, and a
 * half-written opening tag is held back rather than shown as text.
 */
export function parseMessageSegments(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let position = 0;
  OPEN.lastIndex = 0;
  for (let match = OPEN.exec(content); match; match = OPEN.exec(content)) {
    const before = content.slice(position, match.index);
    if (before.trim()) segments.push({ kind: "text", text: before });
    const attrs = attributes(match[1] ?? "");
    const bodyStart = match.index + match[0].length;
    const end = content.indexOf(CLOSE, bodyStart);
    const body = content.slice(bodyStart, end === -1 ? undefined : end);
    const type = (ARTIFACT_TYPES as readonly string[]).includes(attrs.type ?? "")
      ? (attrs.type as ArtifactType)
      : "code";
    const identifier =
      (attrs.id ?? attrs.identifier ?? "").trim() || `artifact-${segments.length + 1}`;
    segments.push({
      kind: "artifact",
      identifier,
      type,
      title: attrs.title?.trim() || identifier,
      language: attrs.language?.trim() || null,
      content: end === -1 ? body.replace(/^\n+/, "") : unfenced(body),
      complete: end !== -1,
    });
    if (end === -1) return segments;
    position = end + CLOSE.length;
    OPEN.lastIndex = position;
  }
  const rest = withoutPartialTag(content.slice(position));
  if (rest.trim()) segments.push({ kind: "text", text: rest });
  return segments;
}

/** One version of an artifact: where it was written, and what it said then. */
export interface ArtifactVersion extends ArtifactBlock {
  messageId: string;
  /** 1 for the first version in the chat. */
  version: number;
}

/**
 * Every artifact in a chat with all its versions, oldest first, from the
 * assistant messages in order.
 */
export function collectArtifacts(
  messages: { id: string; role: string; content: string }[],
): Map<string, ArtifactVersion[]> {
  const artifacts = new Map<string, ArtifactVersion[]>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const segment of parseMessageSegments(message.content)) {
      if (segment.kind !== "artifact") continue;
      const versions = artifacts.get(segment.identifier) ?? [];
      versions.push({ ...segment, messageId: message.id, version: versions.length + 1 });
      artifacts.set(segment.identifier, versions);
    }
  }
  return artifacts;
}

/** The file an artifact downloads as. */
export function artifactFilename(
  artifact: Pick<ArtifactBlock, "identifier" | "type" | "language">,
) {
  const extension: Record<ArtifactType, string> = {
    html: "html",
    react: "jsx",
    svg: "svg",
    mermaid: "mmd",
    markdown: "md",
    code: CODE_EXTENSIONS[artifact.language?.toLowerCase() ?? ""] ?? "txt",
  };
  const base = artifact.identifier.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
  return `${base}.${extension[artifact.type]}`;
}

const CODE_EXTENSIONS: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  jsx: "jsx",
  java: "java",
  go: "go",
  rust: "rs",
  ruby: "rb",
  php: "php",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  swift: "swift",
  kotlin: "kt",
  sql: "sql",
  bash: "sh",
  shell: "sh",
  sh: "sh",
  css: "css",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "html",
  markdown: "md",
};
