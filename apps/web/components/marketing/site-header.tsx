"use client";

import { Button, cn, TesselMark } from "@tessel/ui";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { navigation } from "@/lib/site";
import { useSessionStore } from "@/lib/session-store";

export function SiteHeader() {
  const signedIn = useSessionStore((state) => state.status === "authenticated");
  const pathname = usePathname();
  // The phone menu stays open only on the page it was opened on, so following
  // a link in it closes it.
  const [menuPage, setMenuPage] = useState<string | null>(null);
  const menuOpen = menuPage === pathname;

  const actions = signedIn ? (
    <Button asChild size="sm" className="rounded-full px-4">
      <Link href="/chat">Open Tessel</Link>
    </Button>
  ) : (
    <>
      <Button asChild variant="ghost" size="sm" className="rounded-full px-4">
        <Link href="/login">Log in</Link>
      </Button>
      <Button asChild size="sm" className="rounded-full px-4">
        <Link href="/signup">Get started free</Link>
      </Button>
    </>
  );

  return (
    <header className="bg-paper/80 border-line/70 sticky top-0 z-30 border-b backdrop-blur-md">
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
                    "text-muted hover:text-ink focus-visible:outline-accent rounded-full px-3.5 py-2 text-[0.95rem] transition-colors focus-visible:outline-2",
                    "aria-[current=page]:text-ink aria-[current=page]:font-medium",
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
          className="-mr-2 rounded-full md:hidden"
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuPage(menuOpen ? null : pathname)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {menuOpen ? (
        <div id="site-menu" className="border-line border-t px-5 pt-3 pb-6 md:hidden">
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
