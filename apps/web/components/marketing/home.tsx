import { PLANS } from "@tessel/contracts";
import { Button } from "@tessel/ui";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { Tessellation } from "@/components/tessellation";
import { FEATURES } from "./features-data";
import { ProductPreview } from "./product-preview";

const WORKS_WITH = ["GitHub", "Notion", "Linear", "Claude Desktop", "Cursor", "Any MCP server"];

const STEPS = [
  {
    title: "Bring in your knowledge",
    body: "Upload documents and connect the apps your team uses. Tessel indexes them for your workspace only.",
  },
  {
    title: "Ask in plain words",
    body: "Get answers with sources you can open, or hand Tessel a task and watch it plan the work.",
  },
  {
    title: "Approve, and it's done",
    body: "Tessel asks before it creates, changes, or deletes anything. You stay in charge.",
  },
] as const;

const MODES = ["Answer", "Plan", "Review", "Team"] as const;

/** The home page's content. Also shown behind the log-in and sign-up modal. */
export function Home() {
  const documents = FEATURES.find((feature) => feature.id === "documents")!;
  const agents = FEATURES.find((feature) => feature.id === "agents")!;

  return (
    <>
      {/* Full width, running up under the see-through site header (h-16). */}
      <section className="-mt-16">
        <div className="bg-forest relative isolate overflow-hidden px-5 pt-32 text-center text-white sm:px-8 sm:pt-40">
          <Tessellation className="absolute inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_70%)] opacity-[0.13]" />
          <div className="bg-mint/25 absolute top-[38%] left-1/2 -z-10 h-72 w-[42rem] max-w-full -translate-x-1/2 rounded-full blur-3xl" />

          <Link
            href="/features#agents"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 py-1.5 pr-3 pl-1.5 text-sm text-white/85 transition-colors hover:bg-white/12"
          >
            <span className="bg-mint text-forest rounded-full px-2.5 py-0.5 text-xs font-semibold">
              New
            </span>
            Agents that ask before they act
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>

          <h1 className="mx-auto mt-7 max-w-4xl text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.035em] sm:text-7xl">
            Understand everything your team knows
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-white/75 sm:text-xl">
            Tessel is the AI workspace that reads your documents, works with your tools, and asks
            before it acts. Answers come with sources your whole team can check.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              asChild
              className="text-forest hover:bg-mint h-12 w-full rounded-full bg-white px-7 text-base sm:w-auto"
            >
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
          <p className="mt-4 text-sm text-white/60">Free plan. No card needed.</p>

          <div className="mx-auto mt-14 max-w-5xl sm:mt-16">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section aria-labelledby="works-with" className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <h2 id="works-with" className="text-muted text-center font-sans text-base font-normal">
          Works with the tools your team already uses
        </h2>
        <ul className="font-display text-ink/70 mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-xl font-semibold tracking-tight sm:text-2xl">
          {WORKS_WITH.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>

      <section
        id="features"
        aria-labelledby="features-title"
        className="mx-auto max-w-6xl scroll-mt-20 px-5 pb-24 sm:px-6"
      >
        <div className="max-w-2xl">
          <h2
            id="features-title"
            className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl"
          >
            One workspace for every question and every task
          </h2>
          <p className="text-muted mt-4 text-lg">
            Your documents, your apps, and the most capable AI models, fitted together, with you in
            control.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-6">
          <article className="bg-surface border-line flex flex-col rounded-[1.75rem] border p-7 sm:p-9 md:col-span-4">
            <h3 className="text-2xl font-semibold tracking-tight">{documents.title}</h3>
            <p className="text-muted mt-3 max-w-lg">{documents.summary}</p>
            <div className="bg-paper border-line mt-8 rounded-2xl border p-5 text-sm leading-relaxed">
              <p>
                Refunds in the EU are allowed within 14 days of purchase
                <Cite n={1} />, and annual plans are refunded for the unused months
                <Cite n={2} />.
              </p>
              <div className="bg-surface border-line mt-4 rounded-xl border p-4">
                <p className="text-muted text-xs">Refund policy.pdf, page 3</p>
                <p className="mt-1.5">
                  &ldquo;Customers in the European Union may cancel within{" "}
                  <mark className="bg-mint/70 text-ink rounded px-0.5">14 days of purchase</mark>{" "}
                  for a full refund.&rdquo;
                </p>
              </div>
            </div>
          </article>

          <article className="bg-forest flex flex-col rounded-[1.75rem] p-7 text-white sm:p-9 md:col-span-2">
            <h3 className="text-2xl font-semibold tracking-tight">{agents.title}</h3>
            <p className="mt-3 text-white/75">
              Tessel uses your tools to get work done, and waits for your go-ahead before changing
              anything.
            </p>
            <div className="mt-auto pt-8">
              <div className="rounded-2xl bg-white/10 p-4 text-sm">
                <p className="font-medium">Delete 3 old drafts?</p>
                <div className="mt-3 flex gap-2">
                  <span className="bg-mint text-forest rounded-lg px-3 py-1.5 text-xs font-semibold">
                    Allow
                  </span>
                  <span className="rounded-lg border border-white/25 px-3 py-1.5 text-xs font-medium">
                    Decline
                  </span>
                </div>
              </div>
            </div>
          </article>

          <article className="bg-surface border-line flex flex-col rounded-[1.75rem] border p-7 sm:p-9 md:col-span-3">
            <h3 className="text-2xl font-semibold tracking-tight">Your apps, connected</h3>
            <p className="text-muted mt-3">
              Bring in GitHub, Notion, Linear, or any MCP server, and choose which tools need your
              approval. Use your workspace from Claude Desktop or Cursor too.
            </p>
            <ul className="mt-8 flex flex-wrap gap-2 text-sm">
              {[
                ["GitHub", "Ask first"],
                ["Notion", "Always allow"],
                ["Linear", "Ask first"],
              ].map(([app, policy]) => (
                <li
                  key={app}
                  className="bg-paper border-line flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-1.5"
                >
                  <span className="bg-accent text-accent-ink grid size-6 place-items-center rounded-full text-xs font-semibold">
                    {app?.[0]}
                  </span>
                  {app}
                  <span className="text-muted">{policy}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="bg-surface border-line flex flex-col rounded-[1.75rem] border p-7 sm:p-9 md:col-span-3">
            <h3 className="text-2xl font-semibold tracking-tight">Pick how it works</h3>
            <p className="text-muted mt-3">
              Answer straight away, plan and work through steps, draft and review, or hand parts of
              a task to a team of specialists.
            </p>
            <div className="bg-paper border-line mt-8 grid grid-cols-4 gap-1 rounded-full border p-1 text-center text-sm">
              {MODES.map((mode) => (
                <span
                  key={mode}
                  className={
                    mode === "Plan"
                      ? "bg-accent text-accent-ink rounded-full py-2 font-medium"
                      : "text-muted py-2"
                  }
                >
                  {mode}
                </span>
              ))}
            </div>
          </article>
        </div>

        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.filter((feature) =>
            ["skills", "memory", "teams", "security"].includes(feature.id),
          ).map((feature) => (
            <li key={feature.id} className="bg-surface border-line rounded-[1.5rem] border p-6">
              <feature.icon aria-hidden="true" className="text-accent size-6" />
              <h3 className="mt-4 text-lg font-semibold">{feature.title}</h3>
              <p className="text-muted mt-2 text-[0.95rem]">{feature.summary}</p>
            </li>
          ))}
        </ul>
        <Link
          href="/features"
          className="text-accent mt-8 inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
        >
          Explore every feature
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </section>

      <section aria-labelledby="how-title" className="bg-surface border-line border-y">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
          <h2
            id="how-title"
            className="max-w-xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl"
          >
            From scattered files to answers in minutes
          </h2>
          <ol className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-line border-t pt-6">
                <span className="text-accent font-display text-lg font-semibold">
                  Step {index + 1}
                </span>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">{step.title}</h3>
                <p className="text-muted mt-3">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="plans-title" className="mx-auto max-w-6xl px-5 py-24 sm:px-6">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <h2
              id="plans-title"
              className="text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl"
            >
              Start free. Grow when you&apos;re ready.
            </h2>
            <p className="text-muted mt-4 text-lg">
              Every paid plan includes every model. Pay by card, or with UPI in India.
            </p>
          </div>
          <Button asChild variant="secondary" className="w-fit rounded-full px-6">
            <Link href="/pricing">Compare plans</Link>
          </Button>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[PLANS.free, PLANS.pro, PLANS.max, PLANS.team].map((plan) => (
            <li key={plan.id} className="bg-surface border-line rounded-[1.5rem] border p-6">
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="font-display mt-3 text-3xl font-semibold tracking-tight">
                ${plan.price.usd}
                <span className="text-muted font-sans text-sm font-normal">
                  {plan.price.usd === 0 ? "" : plan.perSeat ? " per person / month" : " / month"}
                </span>
              </p>
              <p className="text-muted mt-2 text-[0.95rem]">{plan.description}</p>
              <p className="mt-4 flex gap-2 text-[0.95rem]">
                <Check aria-hidden="true" className="text-accent mt-0.5 size-4.5 shrink-0" />
                {plan.features[0]}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-3 pb-3 sm:px-5 sm:pb-5">
        <div className="bg-forest relative isolate overflow-hidden rounded-[2rem] px-6 py-20 text-center text-white sm:rounded-[2.75rem] sm:py-28">
          <Tessellation className="absolute inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_at_bottom,black_10%,transparent_70%)] opacity-[0.1]" />
          <h2 className="mx-auto max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            Give your team one place to think
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/75">
            Set up a workspace in a minute and invite your team when you&apos;re ready.
          </p>
          <Button
            asChild
            className="text-forest hover:bg-mint mt-9 h-12 rounded-full bg-white px-8 text-base"
          >
            <Link href="/signup">Get started free</Link>
          </Button>
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
