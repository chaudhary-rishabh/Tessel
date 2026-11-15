import { PLANS } from "@tessel/contracts";
import { Button, cn, TesselMark } from "@tessel/ui";
import { ArrowUpRight, Check, FileText, Mic } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { FeatureSlider, Slide } from "./feature-slider";
import { FEATURES } from "./features-data";
import { Parallax, Reveal, ScrollWords } from "./motion";
import { GlassTile } from "./page-intro";
import { ProductPreview } from "./product-preview";
import { COLUMN, CTA_ON_GREEN, CTA_QUIET, HEADING, SERIF } from "./styles";

const WORKS_WITH = ["GitHub", "Notion", "Linear", "Claude Desktop", "Cursor", "Any MCP server"];

const STEPS = [
  {
    title: "Bring in your knowledge",
    body: "Upload documents and recordings, and connect the apps your team uses. Tessel indexes them for your workspace only.",
  },
  {
    title: "Ask in plain words",
    body: "Type or talk. Get answers with sources you can open, or hand Tessel a task and watch it plan the work.",
  },
  {
    title: "Approve, and it's done",
    body: "Tessel asks before it creates, changes, or deletes anything. You stay in charge.",
  },
] as const;

const delay = (seconds: number) => ({ "--delay": `${seconds}s` }) as CSSProperties;

/** The five bars of the Tessel mark, speaking. */
function VoiceBars({ className }: { className?: string }) {
  const bars = ["h-10", "h-20", "h-14", "h-24", "h-12"];
  return (
    <div className={cn("flex h-24 items-center justify-center gap-2.5", className)}>
      {bars.map((height, index) => (
        <span
          key={height}
          className={cn("speak w-6 rounded-full bg-white", height)}
          style={{ ...delay(index * 0.14), opacity: 1 - index * 0.13 }}
        />
      ))}
    </div>
  );
}

/** The home page's content. Also shown behind the log-in and sign-up modal. */
export function Home() {
  const feature = (id: string) => FEATURES.find((item) => item.id === id)!;

  return (
    <>
      <section className="px-2.5 pt-2.5 sm:px-3 sm:pt-3">
        <div className="green-panel grain relative isolate overflow-hidden rounded-[2rem] pb-56 text-center text-white sm:rounded-[2.5rem] sm:pb-72">
          {/* Glass tiles at different depths, drifting apart as the page scrolls. */}
          <Parallax
            from="page"
            speed={0.32}
            className="absolute top-40 left-[7%] -z-10 hidden lg:block"
          >
            <GlassTile className="size-32 -rotate-12" />
          </Parallax>
          <Parallax
            from="page"
            speed={0.14}
            className="absolute top-[26rem] left-[16%] -z-10 hidden lg:block"
          >
            <GlassTile className="size-16 rotate-6" />
          </Parallax>
          <Parallax
            from="page"
            speed={0.24}
            className="absolute top-36 right-[9%] -z-10 hidden lg:block"
          >
            <GlassTile className="size-24 rotate-[18deg]" />
          </Parallax>
          <Parallax
            from="page"
            speed={0.42}
            className="absolute top-[24rem] right-[5%] -z-10 hidden lg:block"
          >
            <GlassTile className="size-40 -rotate-6" />
          </Parallax>

          <div className={cn(COLUMN, "pt-36 sm:pt-48")}>
            <Link
              href="/features#voice"
              className="rise inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/10 py-1.5 pr-4 pl-1.5 text-sm text-white/90 backdrop-blur transition-colors hover:bg-white/15"
            >
              <span className="bg-mint text-forest rounded-full px-2.5 py-0.5 text-xs font-semibold">
                New
              </span>
              Talk to Tessel out loud
            </Link>
            <h1 className="mx-auto mt-8 max-w-5xl text-[2.65rem] leading-[0.98] font-medium tracking-[-0.05em] sm:text-7xl lg:text-[5.75rem]">
              <span className="rise block" style={delay(0.08)}>
                Understand <em className={SERIF}>everything</em>
              </span>
              <span className="rise block" style={delay(0.2)}>
                your team knows
              </span>
            </h1>
            <p
              className="rise mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-white/75 sm:text-xl"
              style={delay(0.32)}
            >
              Tessel is the AI workspace that reads your documents, works with your tools, and asks
              before it acts. Answers come with sources your whole team can check.
            </p>
            <div
              className="rise mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
              style={delay(0.44)}
            >
              <Button asChild className={cn(CTA_ON_GREEN, "w-full sm:w-auto")}>
                <Link href="/signup">Get started free</Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-12 w-full rounded-full border border-white/25 px-7 text-base text-white hover:bg-white/10 sm:w-auto"
              >
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
            <p className="rise mt-5 text-sm text-white/55" style={delay(0.52)}>
              Free plan. No card needed.
            </p>
          </div>
        </div>

        {/* The product, half on the green and half on the white, with two cards floating off it. */}
        <div className="relative z-10 mx-auto -mt-44 max-w-5xl px-2 sm:-mt-60 sm:px-6">
          <Parallax from="page" speed={-0.05}>
            <div className="rise" style={delay(0.6)}>
              <ProductPreview />
            </div>
          </Parallax>
          <Parallax
            from="page"
            speed={-0.16}
            className="absolute top-24 -left-24 z-10 hidden w-60 xl:block"
          >
            <div className="drift border-line -rotate-3 rounded-2xl border bg-white p-4 text-left text-sm shadow-[0_30px_60px_-30px_rgba(6,36,30,0.5)]">
              <p className="text-muted flex items-center gap-2 text-xs">
                <FileText className="size-3.5" /> Launch plan.pdf, page 4
              </p>
              <p className="mt-2 leading-snug">
                &ldquo;Legal sign-off is{" "}
                <mark className="bg-mint text-ink rounded px-0.5">due 14 August</mark>.&rdquo;
              </p>
            </div>
          </Parallax>
          <Parallax
            from="page"
            speed={-0.24}
            className="absolute top-64 -right-20 z-10 hidden w-56 xl:block"
          >
            <div
              className="drift green-panel grain relative isolate rotate-3 overflow-hidden rounded-2xl p-4 text-left text-sm text-white shadow-[0_30px_60px_-30px_rgba(6,36,30,0.6)]"
              style={delay(1.5)}
            >
              <p className="flex items-center gap-2 text-xs text-white/70">
                <Mic className="size-3.5" /> Listening
              </p>
              <VoiceBars className="mt-1 h-16 scale-75" />
            </div>
          </Parallax>
        </div>
      </section>

      <section aria-labelledby="works-with" className="pt-20 sm:pt-28">
        <h2 id="works-with" className="text-muted text-center text-[0.95rem] font-normal">
          Works with the tools your team already uses
        </h2>
        <div className="marquee-box mt-7 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)]">
          <div className="marquee flex w-max">
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1}
                className="flex shrink-0 items-center gap-14 pr-14 text-2xl font-medium tracking-[-0.03em] sm:text-3xl"
              >
                {[...WORKS_WITH, ...WORKS_WITH].map((name, index) => (
                  <li key={index} className="text-forest/80 flex items-center gap-14">
                    {name}
                    <span className="bg-mint size-2.5 rotate-45 rounded-[3px]" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(COLUMN, "py-28 sm:py-40")}>
        <ScrollWords
          className="text-forest mx-auto max-w-5xl text-[1.9rem] leading-[1.18] font-medium tracking-[-0.035em] sm:text-5xl sm:leading-[1.12]"
          text="Your team's knowledge is scattered across documents, recordings, and a dozen apps. Tessel fits the pieces together: answers with sources you can check, work done with your tools, and nothing changed without your say."
        />
      </section>

      <section id="features" aria-labelledby="features-title" className="scroll-mt-24">
        <Reveal className={COLUMN}>
          <h2 id="features-title" className={cn(HEADING, "max-w-3xl")}>
            One workspace for every question and <em className={SERIF}>every task</em>
          </h2>
          <p className="text-muted mt-5 max-w-xl text-lg leading-relaxed">
            Your documents, your apps, and the most capable AI models, fitted together, with you in
            control.
          </p>
        </Reveal>

        {/* Not inside Reveal: the slider pins itself to the screen and is far taller than it. */}
        <div className="mt-12">
          <FeatureSlider label="What Tessel does">
            <Slide tone="white" label="Documents" title={feature("documents").title}>
              <div className="bg-paper rounded-2xl p-5 text-sm leading-relaxed">
                <p>
                  Refunds in the EU are allowed within 14 days of purchase
                  <Cite n={1} />, and annual plans are refunded for the unused months
                  <Cite n={2} />.
                </p>
                <div className="border-line mt-4 rounded-xl border bg-white p-4">
                  <p className="text-muted text-xs">Refund policy.pdf, page 3</p>
                  <p className="mt-1.5">
                    &ldquo;Customers may cancel within{" "}
                    <mark className="bg-mint text-ink rounded px-0.5">14 days of purchase</mark> for
                    a full refund.&rdquo;
                  </p>
                </div>
              </div>
            </Slide>

            <Slide tone="green" label="Voice" title="Talk it through, and cut in whenever you like">
              <VoiceBars />
              <p className="mt-6 text-center text-lg leading-snug text-white/90">
                &ldquo;Legal review is due on the fourteenth, so I&apos;d settle that first.&rdquo;
              </p>
            </Slide>

            <Slide tone="mint" label="Agents" title={feature("agents").title}>
              <div className="rounded-2xl bg-white p-5 text-sm shadow-[0_20px_40px_-28px_rgba(6,36,30,0.4)]">
                <p className="text-muted flex items-center gap-2.5">
                  <span className="bg-mint text-forest grid size-5 place-items-center rounded-full">
                    <Check className="size-3.5" />
                  </span>
                  Found 3 tickets with no activity in 60 days
                </p>
                <p className="mt-4 text-base font-medium">Close 3 tickets in Linear?</p>
                <div className="mt-3.5 flex gap-2">
                  <span className="bg-forest rounded-full px-5 py-2 text-xs font-medium text-white">
                    Allow
                  </span>
                  <span className="border-line rounded-full border px-5 py-2 text-xs font-medium">
                    Decline
                  </span>
                </div>
              </div>
            </Slide>

            <Slide
              tone="white"
              label="Pages and apps"
              title="Working pages and apps, beside the chat"
            >
              <div className="border-line overflow-hidden rounded-2xl border text-sm">
                <div className="border-line bg-paper flex items-center justify-between border-b px-4 py-2.5 text-xs">
                  <span className="font-medium">Seat calculator</span>
                  <span className="text-muted">Version 2 of 3</span>
                </div>
                <div className="p-5">
                  <p className="text-muted">People on the team</p>
                  <p className="mt-1 text-3xl font-medium tracking-[-0.03em]">12</p>
                  <div className="bg-line relative mt-4 h-1.5 rounded-full">
                    <span className="bg-accent absolute inset-y-0 left-0 w-[46%] rounded-full" />
                    <span className="border-accent absolute top-1/2 left-[46%] size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white" />
                  </div>
                  <p className="border-line mt-5 flex items-baseline justify-between border-t pt-4">
                    <span className="text-muted">Each month</span>
                    <span className="text-xl font-medium tracking-[-0.02em]">$360</span>
                  </p>
                </div>
              </div>
            </Slide>

            <Slide tone="mint" label="Connected apps" title="Your apps, connected, on your terms">
              <ul className="flex flex-col gap-2 text-sm">
                {[
                  ["GitHub", "Ask first"],
                  ["Notion", "Always allow"],
                  ["Linear", "Ask first"],
                ].map(([app, policy]) => (
                  <li
                    key={app}
                    className="flex items-center justify-between rounded-2xl bg-white px-4 py-3.5"
                  >
                    <span className="flex items-center gap-3 font-medium">
                      <span className="bg-forest grid size-8 place-items-center rounded-full text-xs text-white">
                        {app?.[0]}
                      </span>
                      {app}
                    </span>
                    <span className="text-muted">{policy}</span>
                  </li>
                ))}
              </ul>
            </Slide>

            <Slide tone="green" label="Images and video" title="Describe it, and Tessel makes it">
              <div className="grid grid-cols-3 gap-2">
                {[
                  "from-[#b9efc8] to-[#2c8f79]",
                  "from-[#f3f7f4] to-[#86dcae]",
                  "from-[#2c8f79] to-[#0a3129]",
                  "from-[#86dcae] to-[#1f6f64]",
                  "from-[#1f6f64] to-[#b9efc8]",
                  "from-[#ffffff] to-[#b9efc8]",
                ].map((gradient, index) => (
                  <span
                    key={gradient}
                    className={cn(
                      "aspect-square rounded-xl bg-gradient-to-br ring-1 ring-white/15",
                      gradient,
                      index === 1 && "col-span-2 aspect-auto",
                    )}
                  />
                ))}
              </div>
            </Slide>

            <Slide tone="white" label="Ways of working" title={feature("modes").title}>
              <div className="bg-paper grid grid-cols-4 gap-1 rounded-full p-1 text-center text-sm">
                {["Answer", "Plan", "Review", "Team"].map((mode) => (
                  <span
                    key={mode}
                    className={
                      mode === "Plan"
                        ? "bg-forest rounded-full py-2.5 font-medium text-white"
                        : "text-muted py-2.5"
                    }
                  >
                    {mode}
                  </span>
                ))}
              </div>
              <ol className="mt-5 flex flex-col gap-2.5 text-sm">
                {["Read the launch plan", "List what's still open", "Draft the checklist"].map(
                  (step, index) => (
                    <li key={step} className="flex items-center gap-3">
                      <span
                        className={cn(
                          "grid size-5 place-items-center rounded-full text-[0.65rem]",
                          index < 2 ? "bg-mint text-forest" : "border-line text-muted border",
                        )}
                      >
                        {index < 2 ? <Check className="size-3" /> : index + 1}
                      </span>
                      <span className={index < 2 ? "" : "text-muted"}>{step}</span>
                    </li>
                  ),
                )}
              </ol>
            </Slide>
          </FeatureSlider>
        </div>

        <ul className={cn(COLUMN, "mt-24 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4")}>
          {["skills", "memory", "teams", "security"].map(feature).map((item, index) => (
            <Reveal as="li" key={item.id} delay={index * 0.08}>
              <span className="bg-paper text-forest grid size-11 place-items-center rounded-full">
                <item.icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-medium tracking-[-0.02em]">{item.title}</h3>
              <p className="text-muted mt-2 text-[0.95rem] leading-relaxed">{item.summary}</p>
            </Reveal>
          ))}
        </ul>
        <div className={cn(COLUMN, "mt-12")}>
          <Link
            href="/features"
            className="text-forest group inline-flex items-center gap-1.5 font-medium"
          >
            <span className="decoration-forest/30 group-hover:decoration-forest underline underline-offset-[6px] transition-colors">
              See every feature
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </Link>
        </div>
      </section>

      {/* Three cards that stack on top of each other as the page scrolls. */}
      <section aria-labelledby="how-title" className={cn(COLUMN, "pt-28 sm:pt-40")}>
        <Reveal>
          <h2 id="how-title" className={cn(HEADING, "max-w-2xl")}>
            From scattered files to answers <em className={SERIF}>in minutes</em>
          </h2>
        </Reveal>
        <ol className="mt-14">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="sticky pb-6"
              style={{ top: `${6.5 + index * 1.75}rem` }}
            >
              <div
                className={cn(
                  "relative isolate grid min-h-[22rem] gap-8 overflow-hidden rounded-[2rem] p-8 sm:p-12 md:grid-cols-2 md:items-center",
                  index === 0 && "border-line border bg-white",
                  index === 1 && "bg-paper",
                  index === 2 && "green-panel grain text-white",
                )}
              >
                <div>
                  <span
                    className={cn(
                      "font-serif text-6xl italic",
                      index === 2 ? "text-mint" : "text-accent",
                    )}
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-5 text-3xl font-medium tracking-[-0.035em] sm:text-4xl">
                    {step.title}
                  </h3>
                  <p
                    className={cn(
                      "mt-4 max-w-md text-lg leading-relaxed",
                      index === 2 ? "text-white/75" : "text-muted",
                    )}
                  >
                    {step.body}
                  </p>
                </div>
                <div aria-hidden="true" className="text-sm md:justify-self-end">
                  {index === 0 ? (
                    <ul className="flex w-full flex-col gap-2 md:w-80">
                      {[
                        ["Launch plan.pdf", "Indexed"],
                        ["Support call.mp4", "Transcribed"],
                        ["Pricing notes.xlsx", "Indexed"],
                      ].map(([name, status]) => (
                        <li
                          key={name}
                          className="bg-paper flex items-center justify-between rounded-2xl px-4 py-3.5"
                        >
                          <span className="flex items-center gap-3 font-medium">
                            <FileText className="text-accent size-4" />
                            {name}
                          </span>
                          <span className="text-muted">{status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : index === 1 ? (
                    <div className="flex w-full flex-col gap-3 md:w-80">
                      <p className="bg-forest ml-auto max-w-[85%] rounded-3xl rounded-br-lg px-4 py-3 text-white">
                        What&apos;s still open before launch?
                      </p>
                      <p className="max-w-[92%] rounded-3xl rounded-bl-lg bg-white px-4 py-3 leading-relaxed">
                        Three things. Legal review is due on 14 August
                        <Cite n={1} />, and two more follow from it.
                      </p>
                    </div>
                  ) : (
                    <div className="w-full rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur md:w-80">
                      <p className="text-base font-medium">Create the checklist document?</p>
                      <div className="mt-4 flex gap-2">
                        <span className="text-forest rounded-full bg-white px-5 py-2 text-xs font-medium">
                          Allow
                        </span>
                        <span className="rounded-full border border-white/25 px-5 py-2 text-xs font-medium">
                          Decline
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="plans-title" className={cn(COLUMN, "py-28 sm:py-40")}>
        <Reveal className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <h2 id="plans-title" className={HEADING}>
              Start free. Grow when <em className={SERIF}>you&apos;re ready.</em>
            </h2>
            <p className="text-muted mt-5 text-lg leading-relaxed">
              Every paid plan includes every model. Pay by card, or with UPI in India.
            </p>
          </div>
          <Button asChild variant="secondary" className={cn(CTA_QUIET, "w-fit")}>
            <Link href="/pricing">Compare plans</Link>
          </Button>
        </Reveal>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[PLANS.free, PLANS.pro, PLANS.max, PLANS.team].map((plan, index) => (
            <Reveal
              as="li"
              key={plan.id}
              delay={index * 0.08}
              className={cn(
                "relative isolate overflow-hidden rounded-[1.75rem] p-7",
                plan.id === "pro" ? "green-panel grain text-white" : "bg-paper",
              )}
            >
              <h3 className="font-medium">{plan.name}</h3>
              <p className="mt-8 text-5xl font-medium tracking-[-0.05em]">${plan.price.usd}</p>
              <p className={cn("mt-1 text-sm", plan.id === "pro" ? "text-white/65" : "text-muted")}>
                {plan.price.usd === 0
                  ? "Free for ever"
                  : plan.perSeat
                    ? "per person a month"
                    : "a month"}
              </p>
              <p
                className={cn(
                  "mt-6 text-[0.95rem] leading-relaxed",
                  plan.id === "pro" ? "text-white/80" : "text-muted",
                )}
              >
                {plan.description}
              </p>
            </Reveal>
          ))}
        </ul>
      </section>

      <section className="px-2.5 sm:px-3">
        <div className="green-panel grain relative isolate overflow-hidden rounded-[2rem] px-6 py-28 text-center text-white sm:rounded-[2.5rem] sm:py-40">
          <Parallax speed={0.2} className="absolute top-16 left-[10%] -z-10 hidden md:block">
            <GlassTile className="size-28 -rotate-12" />
          </Parallax>
          <Parallax speed={-0.15} className="absolute right-[12%] bottom-20 -z-10 hidden md:block">
            <GlassTile className="size-36 rotate-12" />
          </Parallax>
          <Parallax speed={0.1} className="absolute top-24 right-[26%] -z-10 hidden md:block">
            <GlassTile className="size-14 rotate-6" />
          </Parallax>
          <Reveal>
            <TesselMark className="mx-auto size-14 rounded-2xl shadow-[0_20px_40px_-16px_rgba(0,0,0,0.5)]" />
            <h2 className="mx-auto mt-8 max-w-3xl text-[2.6rem] leading-[1.0] font-medium tracking-[-0.045em] sm:text-7xl">
              Give your team one place <em className={SERIF}>to think</em>
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/75">
              Set up a workspace in a minute and invite your team when you&apos;re ready.
            </p>
            <Button asChild className={cn(CTA_ON_GREEN, "mt-10")}>
              <Link href="/signup">Get started free</Link>
            </Button>
          </Reveal>
        </div>
      </section>
    </>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <sup className="bg-accent/12 text-accent ml-0.5 rounded px-1 py-px text-[0.65rem] font-semibold">
      {n}
    </sup>
  );
}
