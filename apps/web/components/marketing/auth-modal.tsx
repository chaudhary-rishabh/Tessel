"use client";

import { Modal, Spinner, TesselMark } from "@tessel/ui";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { GuestOnly } from "@/components/session-gates";
import { GlassTile } from "./page-intro";
import { SERIF } from "./styles";

const PROMISES = [
  "Answers with sources you can check",
  "Agents that ask before they act",
  "Type it, say it, or hand it over",
] as const;

/** The green side of the account modal: the brand, and what's waiting inside. Decoration only. */
function Welcome() {
  return (
    <div
      aria-hidden="true"
      className="green-panel grain relative isolate m-2 hidden w-[44%] shrink-0 flex-col justify-between overflow-hidden rounded-[1.5rem] p-9 text-white md:flex"
    >
      <GlassTile className="absolute top-10 -right-8 -z-10 size-32 rotate-12" />
      <GlassTile className="absolute top-44 right-24 -z-10 size-14 -rotate-6" />
      <GlassTile className="absolute -bottom-10 -left-8 -z-10 size-36 -rotate-12" />
      <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
        <TesselMark title="" />
        Tessel
      </div>
      <div>
        <p className="text-[2.1rem] leading-[1.04] font-medium tracking-[-0.04em]">
          One place for everything your team <span className={SERIF}>knows</span>
        </p>
        <ul className="mt-7 flex flex-col gap-3 text-[0.95rem] text-white/85">
          {PROMISES.map((promise) => (
            <li key={promise} className="flex items-center gap-3">
              <span className="bg-mint text-forest grid size-5 shrink-0 place-items-center rounded-full">
                <Check className="size-3.5" strokeWidth={2.5} />
              </span>
              {promise}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Log in, sign up, and the other account pages, shown as a modal over the
 * home page. Each keeps its own address, so links and redirects like
 * `/login?next=/settings` work as before. Closing the modal goes home.
 *
 * The modal is white and green like the rest of the public site, whatever
 * the device's theme: `site` sets the light palette, and `auth-form` gives
 * the fields and buttons inside it the site's shapes.
 */
export function AuthModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const loading = (
    <div className="text-muted grid min-h-64 place-items-center">
      <Spinner label="Loading" />
    </div>
  );

  return (
    <Modal
      label="Your Tessel account"
      onClose={() => router.push("/")}
      aside={<Welcome />}
      overlayClassName="bg-[#04201a]/60 backdrop-blur-md"
      className="site border-white/40 shadow-[0_60px_120px_-40px_rgba(4,32,26,0.7)] sm:max-w-[27rem] sm:rounded-[2rem] md:max-w-[56rem]"
      bodyClassName="auth-form sm:px-10 sm:pt-10 sm:pb-10 md:py-12 md:pr-12 md:pl-10"
    >
      <TesselMark className="size-10 md:hidden" />
      <div className="mt-5 flex min-h-[26rem] flex-col md:mt-0 md:justify-center">
        <Suspense fallback={loading}>
          <GuestOnly fallback={loading}>{children}</GuestOnly>
        </Suspense>
      </div>
    </Modal>
  );
}
