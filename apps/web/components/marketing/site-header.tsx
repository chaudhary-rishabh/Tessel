"use client";

import { Button, cn, TesselMark } from "@tessel/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useSessionStore } from "@/lib/session-store";

/** Pages that open on the home page's green hero (the account pages show it behind their modal). */
const OVER_HERO = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/oauth/complete",
]);

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** Whether the page has scrolled away from the very top. */
function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 8,
    () => false,
  );
}

export function SiteHeader() {
  const signedIn = useSessionStore((state) => state.status === "authenticated");
  const pathname = usePathname();
  const scrolled = useScrolled();
  // On the home page the header is part of the green hero: see-through at the
  // top, then frosted glass once the page scrolls under it.
  const onHero = OVER_HERO.has(pathname);

  const actions = signedIn ? (
    <Button
      asChild
      size="sm"
      className={cn("rounded-full px-4", onHero && "text-forest hover:bg-mint bg-white")}
    >
      <Link href="/chat">Open Tessel</Link>
    </Button>
  ) : (
    <>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className={cn("rounded-full px-4", onHero && "text-white hover:bg-white/10")}
      >
        <Link href="/login">Log in</Link>
      </Button>
      <Button
        asChild
        size="sm"
        className={cn("rounded-full px-4", onHero && "text-forest hover:bg-mint bg-white")}
      >
        <Link href="/signup">
          <span className="sm:hidden">Get started</span>
          <span className="hidden sm:inline">Get started free</span>
        </Link>
      </Button>
    </>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 motion-reduce:transition-none",
        onHero
          ? scrolled
            ? "bg-forest/75 border-white/10 text-white shadow-[0_10px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl backdrop-saturate-150"
            : "border-transparent bg-transparent text-white"
          : scrolled
            ? "bg-paper/70 border-line/70 shadow-[0_10px_40px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl backdrop-saturate-150"
            : "bg-paper border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
        <Link
          href="/"
          className="font-display focus-visible:outline-accent flex items-center gap-2.5 rounded-md text-lg font-semibold focus-visible:outline-2"
        >
          <TesselMark />
          Tessel
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">{actions}</div>
      </div>
    </header>
  );
}
