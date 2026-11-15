"use client";

import { cn } from "@tessel/ui";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Calls `update` on the next frame after each scroll or resize, and once at the start. */
function onScrollFrame(update: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    }
  };
  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
  };
}

/**
 * Moves its content at a different speed from the page as it scrolls.
 * A positive speed lags behind the scroll (it looks further away); a
 * negative one runs ahead. `from="page"` measures from the top of the page,
 * for things in view when the page loads; otherwise the content is at rest
 * when it's in the middle of the screen.
 */
export function Parallax({
  speed,
  from = "view",
  className,
  style,
  children,
}: {
  speed: number;
  from?: "page" | "view";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = outer.current;
    const moved = inner.current;
    if (!box || !moved || reducedMotion()) return;
    return onScrollFrame(() => {
      let distance = window.scrollY;
      if (from === "view") {
        const rect = box.getBoundingClientRect();
        distance = window.innerHeight / 2 - (rect.top + rect.height / 2);
      }
      moved.style.transform = `translate3d(0, ${(distance * speed).toFixed(1)}px, 0)`;
    });
  }, [speed, from]);

  return (
    <div ref={outer} className={className} style={style}>
      <div ref={inner} className="will-change-transform">
        {children}
      </div>
    </div>
  );
}

/** Fades its content up the first time it scrolls into view. */
export function Reveal({
  delay = 0,
  as: Tag = "div",
  className,
  children,
}: {
  /** Seconds to wait, for staggering a row of things. */
  delay?: number;
  as?: "div" | "li" | "section";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          element.dataset.shown = "";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      // The element type varies; each of them takes this ref.
      ref={ref as never}
      className={cn("reveal", className)}
      style={{ "--delay": `${delay}s` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/**
 * A statement whose words darken one after another as it scrolls up the
 * screen. Without scripting or with reduced motion, it's simply all dark.
 */
export function ScrollWords({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = text.split(" ");

  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion()) return;
    element.dataset.live = "";
    return onScrollFrame(() => {
      const rect = element.getBoundingClientRect();
      const start = window.innerHeight * 0.85;
      const end = window.innerHeight * 0.35;
      const progress = (start - rect.top) / (start - end + rect.height);
      element.style.setProperty("--progress", Math.min(1, Math.max(0, progress)).toFixed(3));
    });
  }, []);

  return (
    <p ref={ref} className={cn("scroll-words", className)}>
      {words.map((word, index) => (
        <span
          key={index}
          style={{ "--index": index, "--count": words.length + 4 } as CSSProperties}
        >
          {word}{" "}
        </span>
      ))}
    </p>
  );
}
