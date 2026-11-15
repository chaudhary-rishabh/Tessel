"use client";

import { Button, cn, TesselMark } from "@tessel/ui";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useSessionStore } from "@/lib/session-store";

const PAGES = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
] as const;

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
  // The phone menu belongs to the page it was opened on.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-[background-color,border-color] duration-300 motion-reduce:transition-none",
        scrolled || menuOpen
          ? "bg-paper/80 border-line backdrop-blur-xl backdrop-saturate-150"
          : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-5 sm:px-8">
        <Link
          href="/"
          className="focus-visible:outline-accent flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2"
        >
          <TesselMark />
          Tessel
        </Link>

        <nav aria-label="Site" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  aria-current={pathname === page.href ? "page" : undefined}
                  className="text-muted hover:text-ink aria-[current]:text-ink focus-visible:outline-accent rounded-lg px-3 py-2 text-[0.95rem] transition-colors focus-visible:outline-2"
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {signedIn ? (
            <Button asChild size="sm" className="bg-ink text-paper hover:bg-ink/85 rounded-lg px-4">
              <Link href="/chat">Open Tessel</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="rounded-lg px-3.5">
                <Link href="/login">Log in</Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-ink text-paper hover:bg-ink/85 rounded-lg px-3.5"
              >
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuFor(menuOpen ? null : pathname)}
            className="hover:bg-ink/6 focus-visible:outline-accent -mr-2 grid size-10 place-items-center rounded-lg focus-visible:outline-2 md:hidden"
          >
            {menuOpen ? (
              <X aria-hidden="true" className="size-5" />
            ) : (
              <Menu aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav id="site-menu" aria-label="Site" className="border-line border-t md:hidden">
          <ul className="mx-auto flex w-full max-w-6xl flex-col px-5 py-3">
            {PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  aria-current={pathname === page.href ? "page" : undefined}
                  className="text-muted aria-[current]:text-ink block py-3 text-lg"
                >
                  {page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
