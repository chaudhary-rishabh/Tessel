import type { ReactNode } from "react";

/** A plain, readable layout for the privacy policy and terms. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** When the text last changed, as an ISO date. */
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 pt-16 pb-24 sm:px-6 sm:pt-24">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
      <p className="text-muted mt-4">
        Last updated{" "}
        <time dateTime={updated}>
          {new Date(`${updated}T00:00:00Z`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </time>
      </p>
      <div className="[&_a]:text-accent mt-10 flex flex-col gap-4 text-[1.05rem] leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-8 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </div>
    </article>
  );
}
