import { TesselMark } from "@tessel/ui";
import type { ReactNode } from "react";
import { RequireSession } from "@/components/session-gates";

/** A focused page for decisions made on the way back to another app, like OAuth consent. */
export default function ConsentLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
        <div className="font-display flex items-center gap-2.5 text-lg font-semibold">
          <TesselMark />
          Tessel
        </div>
        <main className="border-line bg-surface mt-8 w-full max-w-md rounded-xl border p-6 sm:p-8">
          {children}
        </main>
      </div>
    </RequireSession>
  );
}
