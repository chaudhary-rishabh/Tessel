import { cn } from "@tessel/ui";
import type { ReactNode } from "react";
import { COLUMN } from "./styles";

/** The heading block at the top of a public page, over the same grid as the home page. */
export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="relative isolate -mt-16 overflow-hidden pt-16">
      <div
        aria-hidden="true"
        className="tile-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_60%_100%_at_85%_0%,black_10%,transparent_75%)] opacity-70"
      />
      <div className={cn(COLUMN, "pt-16 pb-14 sm:pt-24 sm:pb-16")}>
        <h1 className="max-w-3xl text-[2.5rem] leading-[1.04] font-semibold tracking-[-0.035em] sm:text-6xl">
          {title}
        </h1>
        {children ? (
          <div className="text-muted mt-5 max-w-2xl text-lg leading-relaxed sm:text-xl">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
