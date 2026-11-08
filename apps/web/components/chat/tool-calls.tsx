"use client";

import type { ToolCallView } from "@tessel/contracts";
import { Button, cn } from "@tessel/ui";
import { Ban, Check, ChevronRight, CircleAlert, Hand, LoaderCircle } from "lucide-react";
import { useState } from "react";

const statusText: Record<ToolCallView["status"], string> = {
  running: "Running",
  waiting: "Waiting for your approval",
  completed: "Done",
  failed: "Failed",
  rejected: "Declined",
  cancelled: "Cancelled",
};

function StatusIcon({ status }: { status: ToolCallView["status"] }) {
  const common = "size-4 shrink-0";
  switch (status) {
    case "running":
      return (
        <LoaderCircle className={cn(common, "text-accent motion-safe:animate-spin")} aria-hidden />
      );
    case "completed":
      return <Check className={cn(common, "text-accent")} aria-hidden />;
    case "failed":
      return <CircleAlert className={cn(common, "text-danger")} aria-hidden />;
    case "waiting":
      return <Hand className={cn(common, "text-ink")} aria-hidden />;
    default:
      return <Ban className={cn(common, "text-muted")} aria-hidden />;
  }
}

const formatValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

/** The call's main argument, short enough for one line. */
function argPreview(call: ToolCallView): string | null {
  // Prefer the argument that names what the step is about.
  const preferred = ["expression", "query", "filename", "name", "title"]
    .map((key) => call.args[key])
    .find((value) => typeof value === "string");
  const first = preferred ?? Object.values(call.args).find((value) => typeof value === "string");
  if (typeof first !== "string") return null;
  const line = first.split("\n")[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/** One step the assistant took: what it used, on what, and how it went. Expands to the details. */
function ToolCallRow({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const preview = argPreview(call);
  const outcome =
    call.status === "failed"
      ? call.error
      : (call.summary ??
        (call.status === "rejected" || call.status === "cancelled"
          ? statusText[call.status]
          : undefined));
  return (
    <li className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="hover:bg-ink/5 focus-visible:outline-accent flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-2"
      >
        <StatusIcon status={call.status} />
        <span className="sr-only">{statusText[call.status]}:</span>
        <span className="shrink-0 font-medium">{call.title}</span>
        {preview ? (
          // On wider screens the outcome often repeats it (6 * 7 = 42); phones hide the outcome.
          <span
            className={cn("text-muted min-w-0 truncate", outcome?.includes(preview) && "sm:hidden")}
          >
            {preview}
          </span>
        ) : null}
        {outcome ? (
          <span
            className={cn(
              "ml-auto hidden shrink-0 sm:inline",
              call.status === "failed" ? "text-danger" : "text-muted",
            )}
          >
            {outcome}
          </span>
        ) : null}
        <ChevronRight
          className={cn(
            "text-muted size-4 shrink-0 transition-transform motion-reduce:transition-none",
            outcome ? "" : "ml-auto",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-line ml-4 flex flex-col gap-2 border-l py-2 pr-2 pl-4">
          {outcome ? (
            <p className={cn("sm:hidden", call.status === "failed" && "text-danger")}>{outcome}</p>
          ) : null}
          <p className="text-muted">{statusText[call.status]}</p>
          {Object.keys(call.args).length > 0 ? (
            <dl className="grid gap-1.5">
              {Object.entries(call.args).map(([name, value]) => (
                <div key={name} className="min-w-0">
                  <dt className="text-muted text-xs">{name.replaceAll("_", " ")}</dt>
                  <dd className="bg-paper max-h-48 overflow-auto rounded-md px-2 py-1 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {formatValue(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ToolCallList({ calls }: { calls: ToolCallView[] }) {
  const shown = calls.filter((call) => call.status !== "waiting");
  if (shown.length === 0) return null;
  return (
    <ul className="-mx-2 flex flex-col" aria-label="Steps">
      {shown.map((call) => (
        <ToolCallRow key={call.id} call={call} />
      ))}
    </ul>
  );
}

/**
 * Asks the user to allow an action that changes the workspace. Nothing
 * happens until they choose; a new message instead cancels it.
 */
export function ApprovalCard({
  call,
  onDecide,
}: {
  call: ToolCallView;
  onDecide?: ((approved: boolean) => Promise<void> | void) | undefined;
}) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const decide = async (approved: boolean) => {
    setChoice(approved);
    try {
      await onDecide?.(approved);
    } finally {
      setChoice(null);
    }
  };
  const headingId = `approval-${call.id}`;
  return (
    <section
      aria-labelledby={headingId}
      className="border-accent/50 bg-paper flex flex-col gap-3 rounded-2xl border p-4"
    >
      <div className="flex items-start gap-3">
        <Hand className="text-accent mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="font-semibold">
            Allow Tessel to {call.title.charAt(0).toLowerCase() + call.title.slice(1)}?
          </h2>
          {call.description ? (
            <p className="text-muted text-sm [overflow-wrap:anywhere]">{call.description}</p>
          ) : null}
        </div>
      </div>
      <ToolCallDetails call={call} />
      {onDecide ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={choice !== null}
            loading={choice === false}
            onClick={() => void decide(false)}
          >
            Decline
          </Button>
          <Button
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={choice !== null}
            loading={choice === true}
            onClick={() => void decide(true)}
          >
            Allow
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ToolCallDetails({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  if (Object.keys(call.args).length === 0) return null;
  return (
    <div className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-accent focus-visible:outline-accent inline-flex items-center gap-1 rounded font-medium hover:underline focus-visible:outline-2"
      >
        <ChevronRight
          className={cn(
            "size-4 transition-transform motion-reduce:transition-none",
            open && "rotate-90",
          )}
          aria-hidden
        />
        {open ? "Hide details" : "Show details"}
      </button>
      {open ? (
        <dl className="mt-2 grid gap-1.5">
          {Object.entries(call.args).map(([name, value]) => (
            <div key={name} className="min-w-0">
              <dt className="text-muted text-xs">{name.replaceAll("_", " ")}</dt>
              <dd className="bg-surface border-line max-h-60 overflow-auto rounded-md border px-2 py-1 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
