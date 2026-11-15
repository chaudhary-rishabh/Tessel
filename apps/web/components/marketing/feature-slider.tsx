"use client";

import { cn } from "@tessel/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

/** A mouse or trackpad on a wide screen, with motion allowed: where pinning feels right. */
const PIN_QUERY =
  "(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

function subscribeToPinQuery(onChange: () => void) {
  const query = window.matchMedia(PIN_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

type Edge = "start" | "middle" | "end";
const edgeOf = (progress: number): Edge =>
  progress <= 0.01 ? "start" : progress >= 0.99 ? "end" : "middle";

/**
 * A row of cards that slides sideways.
 *
 * With a mouse or trackpad the row pins to the screen and scrolling down
 * moves it sideways, card by card, until the last one; then the page carries
 * on down. The section is made as tall as the row is long, so one pixel of
 * scrolling is one pixel of sliding and nothing is hijacked: scrolling back
 * up runs it in reverse.
 *
 * On touch screens, and with reduced motion, it's an ordinary swipeable row
 * that snaps to each card.
 */
export function FeatureSlider({ label, children }: { label: string; children: ReactNode }) {
  const section = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const pinned = useSyncExternalStore(
    subscribeToPinQuery,
    () => window.matchMedia(PIN_QUERY).matches,
    () => false,
  );
  // How far the row has to travel: its full width less what fits on screen.
  const [distance, setDistance] = useState(0);
  const [edge, setEdge] = useState<Edge>("start");

  useEffect(() => {
    const row = track.current;
    if (!row) return;
    const measure = () => setDistance(Math.max(0, row.scrollWidth - row.clientWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [pinned]);

  useEffect(() => {
    const box = section.current;
    const row = track.current;
    if (!box || !row) return;

    let frame = 0;
    const show = (progress: number) => {
      box.style.setProperty("--progress", progress.toFixed(4));
      setEdge(edgeOf(progress));
    };
    const update = () => {
      frame = 0;
      if (pinned) {
        const travelled = Math.min(distance, Math.max(0, -box.getBoundingClientRect().top));
        row.style.transform = `translate3d(${-travelled}px, 0, 0)`;
        show(distance > 0 ? travelled / distance : 0);
      } else {
        row.style.transform = "";
        const room = row.scrollWidth - row.clientWidth;
        show(room > 0 ? row.scrollLeft / room : 0);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    schedule();
    const scroller: Window | HTMLElement = pinned ? window : row;
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pinned, distance]);

  function slide(direction: 1 | -1) {
    const row = track.current;
    const card = row?.querySelector("li");
    if (!row || !card) return;
    const step = direction * (card.clientWidth + 20);
    // Pinned, the page's scroll is the slider's; otherwise the row scrolls itself.
    if (pinned) window.scrollBy({ top: step, behavior: "smooth" });
    else row.scrollBy({ left: step, behavior: "smooth" });
  }

  const ARROW =
    "border-line hover:bg-forest focus-visible:outline-accent grid size-12 place-items-center rounded-full border bg-white transition-colors hover:border-transparent hover:text-white focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-35";

  return (
    <div
      ref={section}
      style={pinned ? { height: `calc(100dvh + ${distance}px)` } : undefined}
      className="relative"
    >
      <div
        className={cn(
          pinned && "sticky top-0 flex h-dvh flex-col justify-center overflow-hidden pt-20",
        )}
      >
        <ul
          ref={track}
          aria-label={label}
          tabIndex={pinned ? undefined : 0}
          className={cn(
            "flex gap-5 px-[max(1.25rem,calc((100vw-72rem)/2+2rem))] py-2",
            pinned
              ? "will-change-transform"
              : "no-scrollbar focus-visible:outline-accent snap-x snap-mandatory scroll-px-[max(1.25rem,calc((100vw-72rem)/2+2rem))] overflow-x-auto scroll-smooth focus-visible:outline-2",
          )}
        >
          {children}
        </ul>
        <div className="mx-auto mt-8 flex w-full max-w-6xl items-center gap-6 px-5 sm:px-8">
          <div className="bg-line relative h-0.5 flex-1 overflow-hidden rounded-full">
            <span
              className="bg-forest absolute inset-y-0 w-1/4 rounded-full"
              style={{ left: "calc(var(--progress, 0) * 75%)" } as CSSProperties}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Previous"
              disabled={edge === "start"}
              onClick={() => slide(-1)}
              className={ARROW}
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next"
              disabled={edge === "end"}
              onClick={() => slide(1)}
              className={ARROW}
            >
              <ArrowRight aria-hidden="true" className="size-5" />
            </button>
          </div>
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
        "relative isolate flex h-[clamp(25rem,calc(100dvh-13.5rem),31rem)] w-[86%] shrink-0 snap-start flex-col overflow-hidden rounded-[2rem] p-7 sm:w-[27rem] sm:p-8",
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
