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
    () => window.scrollY > 24,
    () => false,
  );
}

/** A white pill that floats over the top of every public page. */
export function SiteHeader() {
  const signedIn = useSessionStore((state) => state.status === "authenticated");
  const pathname = usePathname();
  const scrolled = useScrolled();
  // The phone menu belongs to the page it was opened on.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 px-4 pt-5 sm:px-6 sm:pt-6">
      <div
        className={cn(
          "pointer-events-auto mx-auto w-full max-w-5xl border backdrop-blur-xl backdrop-saturate-150 transition-shadow duration-300",
          menuOpen ? "rounded-[1.75rem] bg-white" : "rounded-full bg-white/85",
          scrolled
            ? "border-line shadow-[0_12px_40px_-16px_rgba(10,49,41,0.35)]"
            : "border-white/60 shadow-[0_8px_30px_-18px_rgba(10,49,41,0.5)]",
        )}
      >
        <div className="flex h-14 items-center gap-6 pr-2 pl-5">
          <Link
            href="/"
            className="focus-visible:outline-accent flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2"
          >
            <TesselMark />
            Tessel
          </Link>

          <nav aria-label="Site" className="mx-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {PAGES.map((page) => (
                <li key={page.href}>
                  <Link
                    href={page.href}
                    aria-current={pathname === page.href ? "page" : undefined}
                    className="text-muted hover:text-ink aria-[current]:text-ink aria-[current]:bg-paper focus-visible:outline-accent rounded-full px-4 py-2 text-[0.95rem] transition-colors focus-visible:outline-2"
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-1 md:ml-0">
            {signedIn ? (
              <Button
                asChild
                size="sm"
                className="bg-forest hover:bg-forest-soft h-10 rounded-full px-5 text-white"
              >
                <Link href="/chat">Open Tessel</Link>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="hidden h-10 rounded-full px-4 sm:inline-flex"
                >
                  <Link href="/login">Log in</Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="bg-forest hover:bg-forest-soft h-10 rounded-full px-5 text-white"
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
              className="hover:bg-ink/6 focus-visible:outline-accent grid size-10 place-items-center rounded-full focus-visible:outline-2 md:hidden"
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
            <ul className="flex flex-col px-5 py-3">
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
              {signedIn ? null : (
                <li className="sm:hidden">
                  <Link href="/login" className="text-muted block py-3 text-lg">
                    Log in
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
