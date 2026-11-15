"use client";

import { cn, TesselMark } from "@tessel/ui";
import { ArrowUp, Check, FileText, MessageSquare, Mic, Paperclip, PhoneOff } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

const SCENES = [
  { id: "ask", label: "Ask", about: "A question answered from the team's documents, with sources" },
  { id: "act", label: "Act", about: "A task Tessel worked through, waiting for approval" },
  { id: "talk", label: "Talk", about: "A voice conversation with Tessel" },
  { id: "make", label: "Make", about: "A working calculator Tessel built beside the chat" },
] as const;

type SceneId = (typeof SCENES)[number]["id"];

/**
 * Tessel at work, drawn in HTML so it stays sharp and follows the theme. The
 * tabs switch between four things it does; the pictures themselves are
 * decoration, described by each panel's label.
 */
export function ProductPreview() {
  const [scene, setScene] = useState<SceneId>("ask");
  const id = useId();
  const current = SCENES.find((item) => item.id === scene)!;

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = SCENES.findIndex((item) => item.id === scene);
    const next = SCENES[(index + step + SCENES.length) % SCENES.length]!;
    setScene(next.id);
    document.getElementById(`${id}-tab-${next.id}`)?.focus();
  }

  return (
    <div className="bg-surface overflow-hidden rounded-[1.5rem] border border-white/60 text-left shadow-[0_36px_70px_-34px_rgba(6,36,30,0.5),0_10px_24px_-12px_rgba(6,36,30,0.18)] ring-1 ring-black/5">
      <div className="border-line flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <div
          role="tablist"
          aria-label="What Tessel does"
          onKeyDown={onKeyDown}
          className="bg-paper flex rounded-[0.6rem] p-0.5"
        >
          {SCENES.map((item) => (
            <button
              key={item.id}
              id={`${id}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={scene === item.id}
              aria-controls={`${id}-panel`}
              tabIndex={scene === item.id ? 0 : -1}
              onClick={() => setScene(item.id)}
              className={cn(
                "focus-visible:outline-accent rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 sm:px-5",
                scene === item.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="text-muted ml-auto hidden text-sm sm:block">Acme product team</span>
      </div>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${scene}`}
        aria-label={current.about}
        className="h-[31rem] sm:h-[30rem]"
      >
        <div key={scene} aria-hidden="true" className="h-full animate-[fade-in_0.35s_ease-out]">
          {scene === "ask" ? <Ask /> : null}
          {scene === "act" ? <Act /> : null}
          {scene === "talk" ? <Talk /> : null}
          {scene === "make" ? <Make /> : null}
        </div>
      </div>
    </div>
  );
}

function Frame({ active, children }: { active: string; children: ReactNode }) {
  const chats = ["Q3 launch checklist", "Stale launch tickets", "Seat calculator"];
  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[13rem_1fr]">
      <div className="border-line bg-paper/60 hidden flex-col gap-0.5 border-r p-3 text-sm md:flex">
        <div className="bg-surface border-line rounded-lg border px-3 py-2 font-medium">
          New chat
        </div>
        <div className="mt-2 flex items-center gap-2 px-3 py-1.5">
          <MessageSquare className="size-4" /> Chat
        </div>
        <div className="text-muted flex items-center gap-2 px-3 py-1.5">
          <FileText className="size-4" /> Documents
        </div>
        <p className="text-muted mt-4 px-3 pb-1 text-xs">Recent chats</p>
        {chats.map((chat) => (
          <div
            key={chat}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[0.8rem]",
              chat === active ? "bg-ink/6" : "text-muted",
            )}
          >
            {chat}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-4 p-4 text-[0.85rem] sm:p-6 sm:text-sm">
        {children}
      </div>
    </div>
  );
}

function Asked({ children }: { children: ReactNode }) {
  return <div className="bg-paper ml-auto max-w-[85%] rounded-2xl px-4 py-2.5">{children}</div>;
}

function Composer() {
  return (
    <div className="border-line mt-auto flex items-center gap-3 rounded-xl border px-4 py-3">
      <Paperclip className="text-muted size-4" />
      <span className="text-muted flex-1">Reply to Tessel</span>
      <span className="bg-forest grid size-7 place-items-center rounded-full text-white">
        <ArrowUp className="size-4" />
      </span>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="bg-accent/12 text-accent ml-0.5 rounded px-1 py-px text-[0.65rem] font-semibold">
      {n}
    </sup>
  );
}

function Ask() {
  return (
    <Frame active="Q3 launch checklist">
      <Asked>What do we still need before the Q3 launch?</Asked>
      <div className="max-w-[92%] leading-relaxed">
        <p>
          Three things are still open. Legal review of the new terms is due on 14 August
          <Cite n={1} />, the pricing page needs the India prices
          <Cite n={2} />, and support wants the updated help articles a week before launch
          <Cite n={3} />.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["Launch plan.pdf", "Pricing notes.md", "Support call.mp4"].map((name, index) => (
            <span
              key={name}
              className="border-line text-muted inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
            >
              <span className="bg-accent/12 text-accent grid size-4 place-items-center rounded text-[0.6rem] font-semibold">
                {index + 1}
              </span>
              {name}
            </span>
          ))}
        </div>
      </div>
      <div className="border-line max-w-md rounded-xl border p-3.5">
        <p className="text-muted text-xs">Launch plan.pdf, page 4</p>
        <p className="mt-1.5 leading-relaxed">
          &ldquo;Legal sign-off on the revised terms is{" "}
          <mark className="bg-mint text-ink rounded px-0.5">due 14 August</mark>, two weeks ahead of
          launch.&rdquo;
        </p>
      </div>
      <Composer />
    </Frame>
  );
}

function Act() {
  const steps = ["Searched Linear for launch tickets", "Found 3 with no activity in 60 days"];
  return (
    <Frame active="Stale launch tickets">
      <Asked>Close out the launch tickets nobody has touched in two months.</Asked>
      <ul className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step} className="text-muted flex items-center gap-2.5">
            <span className="bg-accent/12 text-accent grid size-5 place-items-center rounded-md">
              <Check className="size-3.5" />
            </span>
            {step}
          </li>
        ))}
      </ul>
      <div className="border-line max-w-md rounded-xl border p-4">
        <p className="font-medium">Close 3 tickets in Linear?</p>
        <p className="text-muted mt-1 text-xs leading-relaxed sm:text-[0.8rem]">
          LAU-112, LAU-118, and LAU-131. Each gets a comment saying why it was closed.
        </p>
        <div className="mt-3.5 flex gap-2">
          <span className="bg-forest rounded-full px-4 py-1.5 text-xs font-medium text-white">
            Allow
          </span>
          <span className="border-line rounded-full border px-4 py-1.5 text-xs font-medium">
            Decline
          </span>
        </div>
      </div>
      <p className="text-muted">Nothing changes until you choose.</p>
      <Composer />
    </Frame>
  );
}

/** Voice mode, on the same deep green as the real thing. */
function Talk() {
  const bars = [
    ["bg-tile-verdigris", "h-10"],
    ["bg-tile-paper", "h-20"],
    ["bg-tile-ochre", "h-14"],
    ["bg-tile-iris", "h-24"],
    ["bg-tile-moss", "h-12"],
  ] as const;
  return (
    <div className="bg-forest flex h-full flex-col items-center justify-between px-6 py-7 text-center text-white">
      <p className="text-sm text-white/60">0:42</p>
      <div>
        <div className="flex h-24 items-center justify-center gap-2.5">
          {bars.map(([color, height]) => (
            <span key={color} className={cn("w-7 rounded-lg", color, height)} />
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-md text-lg leading-snug sm:text-xl">
          Legal review is due on the fourteenth, so I&apos;d settle that first.
        </p>
      </div>
      <div className="flex gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-white/10">
          <Mic className="size-5" />
        </span>
        <span className="grid size-12 place-items-center rounded-2xl bg-[#d0534a]">
          <PhoneOff className="size-5" />
        </span>
      </div>
    </div>
  );
}

function Make() {
  return (
    <div className="grid h-full md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="hidden flex-col gap-4 p-6 text-sm md:flex">
        <Asked>Build a calculator for what Team would cost us.</Asked>
        <p className="leading-relaxed">
          Here it is. Drag the slider to change the number of people.
        </p>
        <div className="border-line flex items-center gap-3 rounded-xl border p-3">
          <TesselMark className="size-8" />
          <div>
            <p className="font-medium">Seat calculator</p>
            <p className="text-muted text-xs">Interactive page, version 2</p>
          </div>
        </div>
        <Composer />
      </div>
      <div className="border-line bg-paper/60 flex flex-col md:border-l">
        <div className="border-line flex items-center gap-3 border-b px-4 py-2.5 text-sm">
          <span className="font-medium">Seat calculator</span>
          <span className="bg-surface border-line ml-auto rounded-lg border px-2.5 py-1 text-xs">
            Preview
          </span>
          <span className="text-muted text-xs">Code</span>
        </div>
        <div className="grid flex-1 place-items-center p-6">
          <div className="bg-surface border-line w-full max-w-xs rounded-2xl border p-6">
            <p className="text-muted text-sm">People on the team</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">12</p>
            <div className="bg-line relative mt-4 h-1.5 rounded-full">
              <span className="bg-accent absolute inset-y-0 left-0 w-[46%] rounded-full" />
              <span className="bg-surface border-accent absolute top-1/2 left-[46%] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" />
            </div>
            <div className="border-line mt-6 flex items-baseline justify-between border-t pt-4">
              <span className="text-muted text-sm">Each month</span>
              <span className="text-xl font-semibold tracking-tight">$360</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
