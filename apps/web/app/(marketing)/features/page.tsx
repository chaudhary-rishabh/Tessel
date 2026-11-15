import { Button, cn } from "@tessel/ui";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FEATURES } from "@/components/marketing/features-data";
import { PageIntro } from "@/components/marketing/page-intro";
import { COLUMN, CTA, HEADING, SERIF } from "@/components/marketing/styles";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Features",
  description:
    "Cited answers from your documents, agents that ask before they act, voice conversations, pages and apps beside the chat, MCP connectors, skills, memory, and shared team workspaces.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <>
      <PageIntro
        title={
          <>
            Everything your team needs from AI, <em className={SERIF}>in one place</em>
          </>
        }
      >
        <p>
          Tessel brings your documents, your apps, and capable AI models together, with you in
          control of every step.
        </p>
      </PageIntro>

      <div
        className={cn(COLUMN, "grid gap-12 pt-16 pb-24 sm:pt-20 sm:pb-32 lg:grid-cols-[13rem_1fr]")}
      >
        <nav aria-label="Features" className="hidden lg:block">
          <ul className="border-line sticky top-28 flex flex-col border-l text-[0.95rem]">
            {FEATURES.map((feature) => (
              <li key={feature.id}>
                <a
                  href={`#${feature.id}`}
                  className="text-muted hover:text-ink hover:border-ink -ml-px block border-l border-transparent py-1.5 pl-4 transition-colors"
                >
                  {feature.nav}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <ul className="divide-line border-line divide-y border-y">
          {FEATURES.map((feature) => (
            <li
              key={feature.id}
              id={feature.id}
              className="grid scroll-mt-28 gap-8 py-12 md:grid-cols-[1.1fr_1fr] md:gap-12"
            >
              <div>
                <span className="bg-paper text-forest grid size-12 place-items-center rounded-full">
                  <feature.icon aria-hidden="true" className="size-5" />
                </span>
                <h2 className="mt-6 text-2xl font-medium tracking-[-0.03em] sm:text-[2rem]">
                  {feature.title}
                </h2>
                <p className="text-muted mt-3 leading-relaxed">{feature.summary}</p>
              </div>
              <ul className="flex flex-col gap-3.5 text-[0.95rem] md:pt-[4.25rem]">
                {feature.points.map((point) => (
                  <li key={point} className="flex gap-3">
                    <Check aria-hidden="true" className="text-accent mt-0.5 size-4.5 shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <section className="border-line border-t">
        <div
          className={cn(
            COLUMN,
            "flex flex-col items-start gap-8 py-24 sm:py-28 md:flex-row md:items-end md:justify-between",
          )}
        >
          <div>
            <h2 className={HEADING}>Try it on your own documents</h2>
            <p className="text-muted mt-4 text-lg">Free to start. No card needed.</p>
          </div>
          <Button asChild className={CTA}>
            <Link href="/signup">Get started free</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
