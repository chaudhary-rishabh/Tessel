import { TesselMark } from "@tessel/ui";
import Link from "next/link";
import { site } from "@/lib/site";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Get started",
    links: [
      { href: "/signup", label: "Create an account" },
      { href: "/login", label: "Log in" },
      { href: site.repository, label: "Source on GitHub" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy policy" },
      { href: "/terms", label: "Terms of service" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-line bg-surface border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Link
            href="/"
            className="font-display focus-visible:outline-accent flex w-fit items-center gap-2.5 rounded-md text-lg font-semibold focus-visible:outline-2"
          >
            <TesselMark />
            Tessel
          </Link>
          <p className="text-muted mt-4 text-[0.95rem]">
            One AI workspace for your team&apos;s documents, tools, and know-how.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-ink font-sans text-sm font-semibold">{column.title}</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted hover:text-ink text-[0.95rem] transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-line border-t">
        <p className="text-muted mx-auto w-full max-w-6xl px-5 py-6 text-sm sm:px-6">
          © {new Date().getFullYear()} Tessel. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
