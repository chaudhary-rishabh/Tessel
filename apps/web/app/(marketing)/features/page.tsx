import { Button } from "@tessel/ui";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FEATURES } from "@/components/marketing/features-data";
import { PageIntro } from "@/components/marketing/page-intro";
import { pageMetadata } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Features",
  description:
    "Cited answers from your documents, agents that ask before they act, MCP connectors, skills, memory, and shared team workspaces. Everything Tessel does.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <>
      <PageIntro title="Everything your team needs from AI, in one place">
        <p>
          Tessel brings your documents, your apps, and capable AI models together, with you in
          control of every step.
        </p>
      </PageIntro>

      <section aria-label="Features" className="mx-auto max-w-6xl px-5 pb-24 sm:px-6">
        <ul className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <li
              key={feature.id}
              id={feature.id}
              className="border-line bg-surface scroll-mt-24 rounded-[1.75rem] border p-7 sm:p-9"
            >
              <span className="bg-accent/10 text-accent grid size-12 place-items-center rounded-2xl">
                <feature.icon aria-hidden="true" className="size-6" />
              </span>
              <h2 className="mt-6 text-2xl font-semibold tracking-tight">{feature.title}</h2>
              <p className="text-muted mt-3">{feature.summary}</p>
              <ul className="mt-6 flex flex-col gap-3 text-[0.95rem]">
                {feature.points.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <Check aria-hidden="true" className="text-accent mt-0.5 size-4.5 shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-6">
        <div className="bg-tile-deep flex flex-col items-start gap-6 rounded-[2rem] px-8 py-12 text-white sm:px-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Try it on your own documents</h2>
            <p className="mt-2 text-white/75">Free to start. No card needed.</p>
          </div>
          <Button asChild className="text-tile-deep rounded-full bg-white px-6 hover:bg-white/90">
            <Link href="/signup">Get started free</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
