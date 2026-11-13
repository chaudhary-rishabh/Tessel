"use client";

import { cn } from "@tessel/ui";
import type { CSSProperties } from "react";

/**
 * The Tessel mark's five tiles, as in `TesselMark`, with each tile's center
 * and the direction it moves in when it comes loose from the T.
 */
const TILES = [
  { x: 4.5, y: 5, w: 6.6, h: 8, fill: "fill-tile-verdigris" },
  { x: 12, y: 5, w: 8, h: 8, fill: "fill-tile-paper" },
  { x: 20.9, y: 5, w: 6.6, h: 8, fill: "fill-tile-ochre" },
  { x: 12, y: 13.9, w: 3.55, h: 13.1, fill: "fill-tile-iris" },
  { x: 16.45, y: 13.9, w: 3.55, h: 13.1, fill: "fill-tile-moss" },
].map((tile) => {
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  const dx = cx - 16;
  const dy = cy - 16;
  const length = Math.hypot(dx, dy) || 1;
  return { ...tile, ux: dx / length, uy: dy / length };
});

export type VoiceMarkMode = "connecting" | "listening" | "thinking" | "speaking" | "muted";

/**
 * The voice conversation's visual: the Tessel mark, whose tiles move with
 * the sound. While Tessel speaks each tile follows one band of its voice and
 * comes loose from the T; while it listens the whole mark swells with the
 * user's voice; while it thinks the tiles lift one after another.
 */
export function VoiceMark({
  mode,
  bands,
  level,
  className,
}: {
  mode: VoiceMarkMode;
  /** Five frequency bands of Tessel's voice, 0 to 1. */
  bands: number[];
  /** The user's microphone level, 0 to 1. */
  level: number;
  className?: string;
}) {
  const listening = mode === "listening";
  const speaking = mode === "speaking";
  const swell = listening ? 1 + Math.min(level, 1) * 0.12 : 1;
  // A soft light behind the mark that follows whoever is talking.
  const energy = speaking
    ? bands.reduce((sum, band) => sum + Math.min(band, 1), 0) / Math.max(bands.length, 1)
    : listening
      ? Math.min(level, 1)
      : 0;
  return (
    <span className={cn("relative inline-grid place-items-center", className)}>
      <span
        aria-hidden="true"
        className="absolute inset-[-12%] rounded-full transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-none"
        style={{
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--color-mint) 22%, transparent), transparent)",
          opacity: mode === "muted" || mode === "connecting" ? 0.15 : 0.45 + energy * 0.55,
          scale: String(0.85 + energy * 0.3),
        }}
      />
      <svg
        viewBox="-4 -4 40 40"
        aria-hidden="true"
        className="relative size-full"
        data-mode={mode}
        style={{ overflow: "visible" }}
      >
        <g
          className="transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none"
          style={{
            transform: `scale(${swell})`,
            transformOrigin: "16px 16px",
            opacity: mode === "muted" ? 0.35 : mode === "connecting" ? 0.7 : 1,
          }}
        >
          {TILES.map((tile, index) => {
            const band = Math.min(bands[index] ?? 0, 1);
            const push = speaking ? band * 2.6 : listening ? Math.min(level, 1) * 0.6 : 0;
            const grow = speaking ? 1 + band * 0.2 : 1;
            const style: CSSProperties & Record<`--${string}`, string> = {
              transform: `translate(${tile.ux * push}px, ${tile.uy * push}px) scale(${grow})`,
              transformBox: "fill-box",
              transformOrigin: "center",
              "--dx": `${tile.ux * 1.6}px`,
              "--dy": `${tile.uy * 1.6}px`,
              animationDelay: `${index * 140}ms`,
            };
            return (
              <rect
                key={tile.fill}
                x={tile.x}
                y={tile.y}
                width={tile.w}
                height={tile.h}
                rx={1.4}
                className={[
                  tile.fill,
                  "transition-transform duration-100 ease-out motion-reduce:transition-none",
                  mode === "thinking"
                    ? "motion-safe:animate-[voice-lift_1.4s_ease-in-out_infinite]"
                    : "",
                  mode === "connecting"
                    ? "motion-safe:animate-[voice-shimmer_1.4s_ease-in-out_infinite]"
                    : "",
                ].join(" ")}
                style={style}
              />
            );
          })}
        </g>
      </svg>
    </span>
  );
}
