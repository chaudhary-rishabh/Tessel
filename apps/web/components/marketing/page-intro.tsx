import type { ReactNode } from "react";

/** The heading block at the top of a public page. */
export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 pt-16 pb-12 text-center sm:px-6 sm:pt-24">
      <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">{title}</h1>
      {children ? (
        <div className="text-muted mx-auto mt-5 max-w-2xl text-lg sm:text-xl">{children}</div>
      ) : null}
    </div>
  );
}
