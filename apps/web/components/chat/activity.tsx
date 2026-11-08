"use client";

import type { ActivityItemView, AgentModeName } from "@tessel/contracts";
import { cn } from "@tessel/ui";
import { Check, ChevronRight, Circle, CircleAlert, LoaderCircle, Minus } from "lucide-react";
import { useState } from "react";

const statusText: Record<ActivityItemView["status"], string> = {
  pending: "To do",
  running: "In progress",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

function StatusIcon({ status }: { status: ActivityItemView["status"] }) {
  const common = "size-4 shrink-0";
  switch (status) {
    case "running":
      return (
        <LoaderCircle className={cn(common, "text-accent motion-safe:animate-spin")} aria-hidden />
      );
    case "done":
      return <Check className={cn(common, "text-accent")} aria-hidden />;
    case "failed":
      return <CircleAlert className={cn(common, "text-danger")} aria-hidden />;
    case "skipped":
      return <Minus className={cn(common, "text-muted")} aria-hidden />;
    default:
      return <Circle className={cn(common, "text-line")} aria-hidden />;
  }
}

/** What the work amounted to, in words, for the collapsed header. */
function headline(mode: AgentModeName | null, items: ActivityItemView[], live: boolean): string {
  const running = items.find((item) => item.status === "running");
  if (live && running) return running.title;
  const done = items.filter((item) => item.status === "done");
  if (mode === "team" || items.every((item) => item.kind === "worker")) {
    const teammates = new Set(done.map((item) => item.title.split(":")[0]));
    return live
      ? "Working with the team"
      : `Worked with ${teammates.size} teammate${teammates.size === 1 ? "" : "s"}`;
  }
  if (mode === "reflect" || items.every((item) => item.kind === "review")) {
    if (live) return "Reviewing the answer";
    return items.some((item) => item.title === "Fix the issues")
      ? "Reviewed and revised"
      : "Reviewed before answering";
  }
  const steps = items.filter((item) => item.status !== "skipped").length;
  return live ? "Following the plan" : `Worked through a ${steps}-step plan`;
}

function ActivityRow({ item }: { item: ActivityItemView }) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      <StatusIcon status={item.status} />
      <span className="sr-only">{statusText[item.status]}:</span>
      <span
        className={cn(
          "min-w-0 flex-1 [overflow-wrap:anywhere]",
          item.status === "skipped" && "text-muted line-through",
          item.status === "pending" && "text-muted",
        )}
      >
        {item.title}
      </span>
    </>
  );
  if (!item.detail) {
    return <li className="flex items-start gap-2 px-2 py-1.5 text-sm">{content}</li>;
  }
  return (
    <li className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-ink/5 focus-visible:outline-accent flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-2"
      >
        {content}
        <ChevronRight
          className={cn(
            "text-muted mt-0.5 size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <p className="text-muted border-line ml-4 border-l py-1 pr-2 pl-4 [overflow-wrap:anywhere] whitespace-pre-wrap">
          {item.detail}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The stages behind a reply in plan, review, and team modes. Open while the
 * work happens; folded to one line once the answer is written.
 */
export function ActivityPanel({
  items,
  mode,
  live = false,
}: {
  items: ActivityItemView[];
  mode: AgentModeName | null;
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  if (items.length === 0) return null;
  const open = expanded ?? live;
  return (
    <section className="border-line rounded-xl border" aria-label="How this reply was worked out">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setExpanded(!open)}
        className="hover:bg-ink/5 focus-visible:outline-accent flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm focus-visible:outline-2"
      >
        {live ? (
          <LoaderCircle
            className="text-accent size-4 shrink-0 motion-safe:animate-spin"
            aria-hidden
          />
        ) : (
          <Check className="text-accent size-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{headline(mode, items, live)}</span>
        <ChevronRight
          className={cn(
            "text-muted size-4 shrink-0 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <ol className="border-line flex flex-col border-t px-1 py-1" aria-label="Stages">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
