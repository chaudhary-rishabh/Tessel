"use client";

import { Button, TesselMark } from "@tessel/ui";
import Link from "next/link";
import { Tessellation } from "@/components/tessellation";
import { useSessionStore } from "@/lib/session-store";

const capabilities = [
  {
    title: "Answers from your documents",
    body: "Upload handbooks, specs, and notes. Tessel answers with citations you can check.",
  },
  {
    title: "Agents that ask first",
    body: "Agents use your tools to get work done, and pause for your approval before changing anything.",
  },
  {
    title: "Your tools, connected",
    body: "Bring in GitHub, Notion, and Slack through MCP, or reach your workspace from other AI apps.",
  },
];

export default function HomePage() {
  const signedIn = useSessionStore((state) => state.status === "authenticated");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-display flex items-center gap-2.5 text-lg font-semibold">
          <TesselMark />
          Tessel
        </Link>
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/chat">Open Tessel</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Create account</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <h1 className="max-w-xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            One AI workspace for your team&apos;s knowledge and tools.
          </h1>
          <p className="text-muted mt-6 max-w-lg text-lg">
            Chat over your own documents, hand work to agents you stay in control of, and keep it
            all in one place your whole team can use.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href={signedIn ? "/chat" : "/signup"}>
                {signedIn ? "Open Tessel" : "Create your workspace"}
              </Link>
            </Button>
          </div>
        </div>
        <div className="aspect-[4/5] max-h-[34rem] w-full overflow-hidden rounded-3xl md:aspect-auto md:h-[34rem]">
          <Tessellation className="h-full w-full" />
        </div>
      </main>

      <section className="border-line bg-surface border-t">
        <ul className="mx-auto grid max-w-6xl gap-8 px-6 py-14 md:grid-cols-3">
          {capabilities.map((item) => (
            <li key={item.title}>
              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="text-muted mt-2">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
