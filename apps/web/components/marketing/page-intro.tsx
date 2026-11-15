import { cn } from "@tessel/ui";
import type { ReactNode } from "react";
import { Parallax } from "./motion";
import { COLUMN } from "./styles";

/** A glass tile, the shape of the Tessel mark's pieces, for green panels. */
export function GlassTile({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[22%] border border-white/15 bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-[2px]",
        className,
      )}
    />
  );
}

/** The green heading panel at the top of a public page. */
export function PageIntro({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-2.5 pt-2.5 sm:px-3 sm:pt-3">
      <div className="green-panel grain relative isolate overflow-hidden rounded-[2rem] text-white sm:rounded-[2.5rem]">
        <Parallax
          from="page"
          speed={0.25}
          className="absolute top-24 right-[8%] -z-10 hidden md:block"
        >
          <GlassTile className="size-28 rotate-12" />
        </Parallax>
        <Parallax
          from="page"
          speed={0.12}
          className="absolute top-56 right-[22%] -z-10 hidden md:block"
        >
          <GlassTile className="size-16 -rotate-6" />
        </Parallax>
        <div className={cn(COLUMN, "pt-36 pb-16 sm:pt-44 sm:pb-24")}>
          <h1 className="rise max-w-3xl text-[2.6rem] leading-[1.02] font-medium tracking-[-0.045em] sm:text-[4.25rem]">
            {title}
          </h1>
          {children ? (
            <div
              className="rise mt-6 max-w-2xl text-lg leading-relaxed text-white/75 sm:text-xl"
              style={{ "--delay": "0.12s" } as React.CSSProperties}
            >
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
