import { PLANS } from "@tessel/contracts";
import { Button, cn } from "@tessel/ui";
import Link from "next/link";
import { FEATURES } from "./features-data";
import { HeroTiles } from "./hero-tiles";
import { ProductPreview } from "./product-preview";
import { COLUMN, CTA, CTA_QUIET, HEADING } from "./styles";

const WORKS_WITH = ["GitHub", "Notion", "Linear", "Claude Desktop", "Cursor", "Any MCP server"];

const STEPS = [
  {
    title: "Bring in your knowledge",
    body: "Upload documents and recordings, and connect the apps your team uses. Tessel indexes them for your workspace only.",
    color: "bg-tile-verdigris text-white",
  },
  {
    title: "Ask in plain words",
    body: "Type or talk. Get answers with sources you can open, or hand Tessel a task and watch it plan the work.",
    color: "bg-tile-ochre text-tile-ink",
  },
  {
    title: "Approve, and it's done",
    body: "Tessel asks before it creates, changes, or deletes anything. You stay in charge.",
    color: "bg-tile-iris text-tile-ink",
  },
] as const;

const MODES = ["Answer", "Plan", "Review", "Team"] as const;
const MAKES = ["Web pages", "Apps", "Diagrams", "Documents", "Images", "Video"] as const;
const CARD = "bg-surface border-line flex flex-col rounded-2xl border p-7 sm:p-8";
const CARD_TITLE = "text-xl font-semibold tracking-tight";

/** The home page's content. Also shown behind the log-in and sign-up modal. */
export function Home() {
  const feature = (id: string) => FEATURES.find((item) => item.id === id)!;
  const documents = feature("documents");
  const agents = feature("agents");
  const voice = feature("voice");
  const create = feature("create");

  return (
    <>
      {/* Runs up under the see-through site header (h-16). */}
      <section className="relative isolate -mt-16 overflow-hidden pt-16">
        <div
          aria-hidden="true"
          className="tile-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_90%_70%_at_50%_0%,black_10%,transparent_75%)] opacity-70 lg:[mask-image:radial-gradient(ellipse_60%_75%_at_78%_32%,black_25%,transparent_75%)]"
        />
        <HeroTiles />

        <div className={cn(COLUMN, "pt-16 sm:pt-24 lg:pt-28")}>
          <div className="lg:max-w-[39rem]">
            <Link
              href="/features#voice"
              className="border-line bg-surface hover:border-ink/25 inline-flex items-center gap-2.5 rounded-lg border py-1.5 pr-3.5 pl-2.5 text-sm transition-colors"
            >
              <span className="bg-tile-ochre size-2.5 rounded-[3px]" />
              New: talk to Tessel out loud
            </Link>
            <h1 className="mt-7 text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.04em] sm:text-6xl lg:text-[4.5rem]">
              Understand everything your team knows
            </h1>
            <p className="text-muted mt-6 max-w-xl text-lg leading-relaxed sm:text-xl">
              Tessel is the AI workspace that reads your documents, works with your tools, and asks
              before it acts. Answers come with sources your whole team can check.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild className={CTA}>
                <Link href="/signup">Get started free</Link>
              </Button>
              <Button asChild variant="secondary" className={CTA_QUIET}>
                <Link href="/pricing">See pricing</Link>
              </Button>
              <p className="text-muted text-sm sm:ml-2">Free plan. No card needed.</p>
            </div>
          </div>

          <div className="mt-16 sm:mt-20">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section aria-labelledby="works-with" className={cn(COLUMN, "pt-20 sm:pt-24")}>
        <div className="border-line flex flex-col gap-5 border-y py-7 md:flex-row md:items-center md:gap-10">
          <h2 id="works-with" className="text-muted shrink-0 text-[0.95rem] font-normal">
            Works with the tools your team already uses
          </h2>
          <ul className="flex flex-wrap gap-x-8 gap-y-3 text-[1.05rem] font-medium tracking-tight md:ml-auto">
            {WORKS_WITH.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="features"
        aria-labelledby="features-title"
        className={cn(COLUMN, "scroll-mt-20 py-24 sm:py-32")}
      >
        <div className="max-w-2xl">
          <h2 id="features-title" className={HEADING}>
            One workspace for every question and every task
          </h2>
          <p className="text-muted mt-5 text-lg leading-relaxed">
            Your documents, your apps, and the most capable AI models, fitted together, with you in
            control.
          </p>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <article className={cn(CARD, "md:col-span-4")}>
            <h3 className={CARD_TITLE}>{documents.title}</h3>
            <p className="text-muted mt-2.5 max-w-lg leading-relaxed">{documents.summary}</p>
            <div className="bg-paper mt-8 rounded-xl p-5 text-sm leading-relaxed">
              <p>
                Refunds in the EU are allowed within 14 days of purchase
                <Cite n={1} />, and annual plans are refunded for the unused months
                <Cite n={2} />.
              </p>
              <div className="bg-surface border-line mt-4 rounded-lg border p-4">
                <p className="text-muted text-xs">Refund policy.pdf, page 3</p>
                <p className="mt-1.5">
                  &ldquo;Customers in the European Union may cancel within{" "}
                  <mark className="bg-tile-ochre/30 text-ink rounded px-0.5">
                    14 days of purchase
                  </mark>{" "}
                  for a full refund.&rdquo;
                </p>
              </div>
            </div>
          </article>

          <article className={cn(CARD, "md:col-span-2")}>
            <h3 className={CARD_TITLE}>{agents.title}</h3>
            <p className="text-muted mt-2.5 leading-relaxed">
              Tessel uses your tools to get work done, and waits for your go-ahead before changing
              anything.
            </p>
            <div className="mt-auto pt-8">
              <div className="bg-paper rounded-xl p-4 text-sm">
                <p className="font-medium">Delete 3 old drafts?</p>
                <div className="mt-3 flex gap-2">
                  <span className="bg-ink text-paper rounded-lg px-3.5 py-1.5 text-xs font-medium">
                    Allow
                  </span>
                  <span className="border-line bg-surface rounded-lg border px-3.5 py-1.5 text-xs font-medium">
                    Decline
                  </span>
                </div>
              </div>
            </div>
          </article>

          {/* Voice mode's own deep green, the one dark panel on the page. */}
          <article className="bg-forest flex flex-col rounded-2xl p-7 text-white sm:p-8 md:col-span-2">
            <h3 className={CARD_TITLE}>{voice.title}</h3>
            <p className="mt-2.5 leading-relaxed text-white/70">
              Speak, and Tessel answers out loud in under a second. Cut in whenever you like.
            </p>
            <div
              aria-hidden="true"
              className="mt-auto flex h-28 items-end justify-center gap-2 pt-8"
            >
              {(
                [
                  ["bg-tile-verdigris", "h-8"],
                  ["bg-tile-paper", "h-16"],
                  ["bg-tile-ochre", "h-11"],
                  ["bg-tile-iris", "h-20"],
                  ["bg-tile-moss", "h-9"],
                ] as const
              ).map(([color, height]) => (
                <span key={color} className={cn("w-6 rounded-md", color, height)} />
              ))}
            </div>
          </article>

          <article className={cn(CARD, "md:col-span-4")}>
            <h3 className={CARD_TITLE}>{create.title}</h3>
            <p className="text-muted mt-2.5 max-w-lg leading-relaxed">{create.summary}</p>
            <div className="mt-auto grid gap-4 pt-8 sm:grid-cols-[1fr_auto] sm:items-end">
              <ul className="flex flex-wrap gap-2 text-sm">
                {MAKES.map((item) => (
                  <li key={item} className="bg-paper rounded-lg px-3 py-1.5">
                    {item}
                  </li>
                ))}
              </ul>
              <div
                aria-hidden="true"
                className="border-line hidden w-52 overflow-hidden rounded-xl border text-xs sm:block"
              >
                <div className="border-line bg-paper flex items-center justify-between border-b px-3 py-2">
                  <span className="font-medium">Preview</span>
                  <span className="text-muted">Version 2 of 3</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 p-3">
                  <span className="bg-tile-verdigris col-span-2 h-9 rounded-md" />
                  <span className="bg-tile-ochre h-9 rounded-md" />
                  <span className="bg-tile-iris h-9 rounded-md" />
                  <span className="bg-tile-moss col-span-2 h-9 rounded-md" />
                </div>
              </div>
            </div>
          </article>

          <article className={cn(CARD, "md:col-span-3")}>
            <h3 className={CARD_TITLE}>Your apps, connected</h3>
            <p className="text-muted mt-2.5 leading-relaxed">
              Bring in GitHub, Notion, Linear, or any MCP server, and choose which tools need your
              approval. Use your workspace from Claude Desktop or Cursor too.
            </p>
            <ul className="mt-auto flex flex-col gap-px pt-8 text-sm">
              {[
                ["GitHub", "Ask first"],
                ["Notion", "Always allow"],
                ["Linear", "Ask first"],
              ].map(([app, policy]) => (
                <li
                  key={app}
                  className="border-line flex items-center justify-between border-t py-2.5"
                >
                  <span className="font-medium">{app}</span>
                  <span className="text-muted">{policy}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className={cn(CARD, "md:col-span-3")}>
            <h3 className={CARD_TITLE}>Pick how it works</h3>
            <p className="text-muted mt-2.5 leading-relaxed">
              Answer straight away, plan and work through steps, draft and review, or hand parts of
              a task to a team of specialists.
            </p>
            <div className="mt-auto pt-8">
              <div className="bg-paper grid grid-cols-4 gap-1 rounded-[0.7rem] p-1 text-center text-sm">
                {MODES.map((mode) => (
                  <span
                    key={mode}
                    className={
                      mode === "Plan"
                        ? "bg-surface rounded-lg py-2 font-medium shadow-sm"
                        : "text-muted py-2"
                    }
                  >
                    {mode}
                  </span>
                ))}
              </div>
            </div>
          </article>
        </div>

        <ul className="border-line mt-14 grid gap-x-10 gap-y-9 border-t pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {["skills", "memory", "teams", "security"].map(feature).map((item) => (
            <li key={item.id}>
              <item.icon aria-hidden="true" className="size-5" />
              <h3 className="mt-4 font-semibold tracking-tight">{item.title}</h3>
              <p className="text-muted mt-1.5 text-[0.95rem] leading-relaxed">{item.summary}</p>
            </li>
          ))}
        </ul>
        <Link
          href="/features"
          className="decoration-line hover:decoration-ink mt-10 inline-block font-medium underline underline-offset-[6px] transition-colors"
        >
          See every feature
        </Link>
      </section>

      <section aria-labelledby="how-title" className="border-line border-y">
        <div className={cn(COLUMN, "py-24 sm:py-32")}>
          <h2 id="how-title" className={cn(HEADING, "max-w-xl")}>
            From scattered files to answers in minutes
          </h2>
          <ol className="mt-14 grid gap-10 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span
                  className={cn(
                    "grid size-9 place-items-center rounded-[0.6rem] font-semibold",
                    step.color,
                  )}
                >
                  {index + 1}
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-tight">{step.title}</h3>
                <p className="text-muted mt-2.5 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="plans-title" className={cn(COLUMN, "py-24 sm:py-32")}>
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-xl">
            <h2 id="plans-title" className={HEADING}>
              Start free. Grow when you&apos;re ready.
            </h2>
            <p className="text-muted mt-5 text-lg leading-relaxed">
              Every paid plan includes every model. Pay by card, or with UPI in India.
            </p>
          </div>
          <Button asChild variant="secondary" className={cn(CTA_QUIET, "w-fit")}>
            <Link href="/pricing">Compare plans</Link>
          </Button>
        </div>
        <ul className="border-line bg-surface divide-line mt-12 grid divide-y overflow-hidden rounded-2xl border sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {[PLANS.free, PLANS.pro, PLANS.max, PLANS.team].map((plan) => (
            <li key={plan.id} className="p-7">
              <h3 className="font-semibold tracking-tight">{plan.name}</h3>
              <p className="mt-4 text-4xl font-semibold tracking-[-0.03em]">
                ${plan.price.usd}
                <span className="text-muted ml-1.5 text-sm font-normal tracking-normal">
                  {plan.price.usd === 0 ? "" : plan.perSeat ? "per person a month" : "a month"}
                </span>
              </p>
              <p className="text-muted mt-3 text-[0.95rem] leading-relaxed">{plan.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="tile-grid border-line absolute inset-0 -z-10 border-t [mask-image:radial-gradient(ellipse_70%_100%_at_50%_100%,black_15%,transparent_75%)] opacity-70"
        />
        <div className={cn(COLUMN, "py-28 text-center sm:py-40")}>
          <h2 className="mx-auto max-w-3xl text-4xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-6xl">
            Give your team one place to think
          </h2>
          <p className="text-muted mx-auto mt-5 max-w-xl text-lg leading-relaxed">
            Set up a workspace in a minute and invite your team when you&apos;re ready.
          </p>
          <Button asChild className={cn(CTA, "mt-9")}>
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
