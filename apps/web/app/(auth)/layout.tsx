import { TesselMark } from "@tessel/ui";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { FullPageSpinner } from "@/components/full-page-spinner";
import { GuestOnly } from "@/components/session-gates";
import { Tessellation } from "@/components/tessellation";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <GuestOnly>
        <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <Tessellation className="h-20 w-full md:hidden" />

          <div className="flex flex-1 flex-col px-6 pt-6 pb-10 sm:px-10 md:pt-10">
            <Link
              href="/"
              className="font-display focus-visible:outline-accent flex w-fit items-center gap-2.5 rounded-md text-lg font-semibold focus-visible:outline-2"
            >
              <TesselMark />
              Tessel
            </Link>
            <main className="mx-auto flex w-full max-w-sm flex-1 flex-col pt-10 md:justify-center md:py-10">
              {children}
            </main>
          </div>

          <div className="relative hidden overflow-hidden md:block">
            <Tessellation className="absolute inset-0 h-full w-full" />
            <p className="bg-paper/92 font-display text-ink absolute right-10 bottom-10 left-10 max-w-md rounded-xl p-6 text-2xl leading-snug font-medium shadow-lg backdrop-blur">
              Your team&apos;s documents, tools, and AI, fitted together in one workspace.
            </p>
          </div>
        </div>
      </GuestOnly>
    </Suspense>
  );
}
