"use client";

import { cn } from "@tessel/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row of cards that slides sideways: drag or swipe it, scroll it, or use
 * the arrows. Cards snap into place, and a bar shows how far along you are.
 */
export function FeatureSlider({ label, children }: { label: string; children: ReactNode }) {
  const track = useRef<HTMLUListElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const update = () => {
      const room = element.scrollWidth - element.clientWidth;
      setProgress(room > 0 ? element.scrollLeft / room : 0);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  function slide(direction: 1 | -1) {
    const element = track.current;
    const card = element?.querySelector("li");
    if (!element || !card) return;
    element.scrollBy({ left: direction * (card.clientWidth + 20), behavior: "smooth" });
  }

  const ARROW =
    "border-line hover:bg-forest focus-visible:outline-accent grid size-12 place-items-center rounded-full border bg-white transition-colors hover:border-transparent hover:text-white focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-35";

  return (
    <div>
      <ul
        ref={track}
        aria-label={label}
        tabIndex={0}
        className="no-scrollbar focus-visible:outline-accent flex snap-x snap-mandatory scroll-px-[max(1.25rem,calc((100vw-72rem)/2+2rem))] gap-5 overflow-x-auto scroll-smooth px-[max(1.25rem,calc((100vw-72rem)/2+2rem))] py-2 focus-visible:outline-2"
      >
        {children}
      </ul>
      <div className="mx-auto mt-8 flex w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
        <div className="bg-line relative h-0.5 flex-1 overflow-hidden rounded-full">
          <span
            className="bg-forest absolute inset-y-0 left-0 w-1/4 rounded-full transition-[left] duration-150 ease-out"
            style={{ left: `${progress * 75}%` }}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="Previous"
            disabled={progress <= 0.01}
            onClick={() => slide(-1)}
            className={ARROW}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next"
            disabled={progress >= 0.99}
            onClick={() => slide(1)}
            className={ARROW}
          >
            <ArrowRight aria-hidden="true" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** One card in the slider. */
export function Slide({
  tone,
  label,
  title,
  children,
}: {
  tone: "white" | "mint" | "green";
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative isolate flex h-[31rem] w-[86%] shrink-0 snap-start flex-col overflow-hidden rounded-[2rem] p-7 sm:w-[27rem] sm:p-8",
        tone === "white" && "border-line border bg-white",
        tone === "mint" && "bg-paper",
        tone === "green" && "green-panel grain text-white",
      )}
    >
      <p className={cn("text-sm", tone === "green" ? "text-white/65" : "text-muted")}>{label}</p>
      <h3 className="mt-3 text-[1.7rem] leading-[1.1] font-medium tracking-[-0.03em]">{title}</h3>
      <div aria-hidden="true" className="mt-auto pt-8">
        {children}
      </div>
    </li>
  );
}
