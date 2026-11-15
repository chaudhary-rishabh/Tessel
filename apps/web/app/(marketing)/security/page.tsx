import { cn } from "@tessel/ui";
import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { COLUMN } from "@/components/marketing/styles";
import { pageMetadata, site } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Security",
  description:
    "How Tessel keeps your workspace private: row-level security in Postgres, two-step sign-in, approvals for risky actions, moderation, and an audit log.",
  path: "/security",
});

const sections = [
  {
    title: "Your workspace is walled off",
    points: [
      "Every workspace is isolated twice: in the app's own checks, and again by row-level security in Postgres, a second line of defence if the first ever slips.",
      "Search indexes, the knowledge graph, and file storage are all scoped to the workspace.",
      "Workspaces you don't belong to look like they don't exist.",
    ],
  },
  {
    title: "Sign-in you can trust",
    points: [
      "Passwords are hashed with Argon2id. Sessions use short-lived tokens and a refresh cookie the page itself can't read, rotated on every use, with reuse detection.",
      "Two-step sign-in with an authenticator app, plus recovery codes.",
      "See every signed-in device and sign any one out. Changing your password signs out the rest.",
      "Sign in with Google or GitHub, or with a texted code.",
    ],
  },
  {
    title: "AI that stays in its lane",
    points: [
      "Anything that changes your workspace waits for your approval.",
      "Documents, tool results, and connected apps are treated as data, never as instructions.",
      "Messages are moderated before a model sees them, and every model call is capped and recorded.",
      "Workspace and user identity come from your session, never from the model.",
    ],
  },
  {
    title: "Visibility for admins",
    points: [
      "An audit log of sign-ins, member changes, tokens, connected apps, and deleted documents, kept for a year.",
      "Removing someone ends their access tokens and connected apps in that workspace.",
      "Owners can delete a team workspace and everything in it.",
      "Admins choose which tools ask first and which connected apps are allowed.",
    ],
  },
  {
    title: "Things it makes are fenced in",
    points: [
      "Pages and apps Tessel builds run in a sandbox that can't reach your workspace, your session, or your files.",
      "A copy of your voice is made only from a recording of you reading a one-time code, and you can delete it.",
    ],
  },
] as const;

export default function SecurityPage() {
  return (
    <>
      <PageIntro title="Security built into every layer">
        <p>
          Your team&apos;s knowledge is the most valuable thing in Tessel. Here&apos;s how we
          protect it.
        </p>
      </PageIntro>
      <section aria-label="How Tessel protects your data" className={cn(COLUMN, "pb-24 sm:pb-32")}>
        <div className="divide-line border-line divide-y border-y">
          {sections.map((section) => (
            <div
              key={section.title}
              className="grid gap-6 py-12 md:grid-cols-[1fr_1.5fr] md:gap-12"
            >
              <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-4 leading-relaxed">
                {section.points.map((point) => (
                  <li key={point} className="flex gap-3.5">
                    <span
                      aria-hidden="true"
                      className="bg-tile-verdigris mt-[0.55rem] size-2 shrink-0 rounded-[2px]"
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <div className="bg-surface border-line rounded-2xl border p-7 sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Read the code</h2>
            <p className="text-muted mt-2.5 leading-relaxed">
              Tessel&apos;s source is public, so you can check how any of this works for yourself.
            </p>
            <a
              href={site.repository}
              className="decoration-line hover:decoration-ink mt-5 inline-block font-medium underline underline-offset-[6px] transition-colors"
            >
              Tessel on GitHub
            </a>
          </div>
          <div className="bg-surface border-line rounded-2xl border p-7 sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Found a problem?</h2>
            <p className="text-muted mt-2.5 leading-relaxed">
              Tell us what you found and how to reproduce it. We read every report.
            </p>
            <a
              href={`mailto:${site.contactEmail}`}
              className="decoration-line hover:decoration-ink mt-5 inline-block font-medium underline underline-offset-[6px] transition-colors"
            >
              {site.contactEmail}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
