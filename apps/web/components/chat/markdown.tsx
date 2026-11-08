"use client";

import { Check, Copy } from "lucide-react";
import type { MessageSource } from "@tessel/contracts";
import { memo, useMemo, useState, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip, linkCitations } from "./citations";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be refused; nothing else to do.
        }
      }}
      className="text-muted hover:text-ink hover:bg-ink/6 focus-visible:outline-accent inline-flex size-8 items-center justify-center rounded-md focus-visible:outline-2"
    >
      {copied ? (
        <Check className="size-4" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}

function CodeBlock({ children, ...props }: ComponentProps<"pre">) {
  const code = (children as { props?: { children?: unknown; className?: string } } | undefined)
    ?.props;
  const text = typeof code?.children === "string" ? code.children.replace(/\n$/, "") : "";
  const language = /language-([\w-]+)/.exec(code?.className ?? "")?.[1];
  return (
    <div className="border-line bg-paper my-4 overflow-hidden rounded-xl border">
      <div className="border-line text-muted flex items-center justify-between border-b py-1 pr-1 pl-3 text-xs">
        <span>{language ?? "code"}</span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre className="overflow-x-auto p-3 text-sm leading-relaxed" {...props}>
        {children}
      </pre>
    </div>
  );
}

function MarkdownLink({
  children,
  href,
  node: _node,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2"
      {...props}
    >
      {children}
    </a>
  );
}

const components: Components = {
  pre: CodeBlock,
  code: ({ className, children, ...props }) => (
    <code className={className ?? "bg-ink/6 rounded px-1 py-0.5 text-[0.9em]"} {...props}>
      {children}
    </code>
  ),
  a: MarkdownLink,
  table: ({ children, ...props }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th className="border-line border-b px-3 py-2 text-left font-semibold" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td className="border-line border-b px-3 py-2 align-top" {...props}>
      {children}
    </td>
  ),
};

const NO_SOURCES: MessageSource[] = [];

/**
 * Model output as Markdown. Raw HTML in the text is shown as text, never
 * rendered. [n] markers that match a source become citation chips.
 */
export const Markdown = memo(function Markdown({
  text,
  sources = NO_SOURCES,
}: {
  text: string;
  sources?: MessageSource[];
}) {
  const withCitations = useMemo<Components>(
    () => ({
      ...components,
      a: (props) => {
        const id = props.href?.startsWith("#source-") ? Number(props.href.slice(8)) : NaN;
        const source = sources.find((item) => item.id === id);
        return source ? <CitationChip source={source} /> : <MarkdownLink {...props} />;
      },
    }),
    [sources],
  );
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={withCitations}>
        {linkCitations(text, sources)}
      </ReactMarkdown>
    </div>
  );
});
