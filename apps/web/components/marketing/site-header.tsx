"use client";

import { Button, cn, TesselMark } from "@tessel/ui";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { navigation } from "@/lib/site";
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
  // The phone menu stays open only on the page it was opened on, so following
  // a link in it closes it.
  const [menuPage, setMenuPage] = useState<string | null>(null);
  const menuOpen = menuPage === pathname;
  const glass = scrolled || menuOpen;

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
        <Link href="/signup">Get started free</Link>
      </Button>
    </>
  );

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 motion-reduce:transition-none",
        onHero
          ? glass
            ? "bg-forest/75 border-white/10 text-white shadow-[0_10px_40px_-18px_rgba(0,0,0,0.55)] backdrop-blur-xl backdrop-saturate-150"
            : "border-transparent bg-transparent text-white"
          : glass
            ? "bg-paper/70 border-line/70 shadow-[0_10px_40px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl backdrop-saturate-150"
            : "bg-paper border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-6">
        <Link
          href="/"
          className="font-display focus-visible:outline-accent flex items-center gap-2.5 rounded-md text-lg font-semibold focus-visible:outline-2"
        >
          <TesselMark />
          Tessel
        </Link>

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {navigation.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={cn(
                    "focus-visible:outline-accent rounded-full px-3.5 py-2 text-[0.95rem] transition-colors focus-visible:outline-2 aria-[current=page]:font-medium",
                    onHero
                      ? "text-white/75 hover:text-white aria-[current=page]:text-white"
                      : "text-muted hover:text-ink aria-[current=page]:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 md:flex">{actions}</div>

        <Button
          variant="ghost"
          size="icon"
          className={cn("-mr-2 rounded-full md:hidden", onHero && "text-white hover:bg-white/10")}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuPage(menuOpen ? null : pathname)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {menuOpen ? (
        <div
          id="site-menu"
          className={cn(
            "border-t px-5 pt-3 pb-6 md:hidden",
            onHero ? "border-white/10" : "border-line",
          )}
        >
          <nav aria-label="Main">
            <ul className="flex flex-col">
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="font-display block rounded-lg py-3 text-lg font-medium"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className={cn("mt-4 grid gap-2 *:w-full", !signedIn && "grid-cols-2")}>
            {actions}
          </div>
        </div>
      ) : null}
    </header>
  );
}
