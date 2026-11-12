import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { pageMetadata } from "@/lib/site";

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
      <section
        aria-label="How Tessel protects your data"
        className="mx-auto max-w-4xl px-5 pb-24 sm:px-6"
      >
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <div
              key={section.title}
              className="border-line bg-surface rounded-[1.75rem] border p-7 sm:p-9"
            >
              <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
              <ul className="text-muted marker:text-accent mt-5 flex list-disc flex-col gap-3 pl-5">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
