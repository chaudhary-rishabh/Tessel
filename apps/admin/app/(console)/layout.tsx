"use client";

import { toApiClientError } from "@tessel/api-client";
import { useApi } from "@tessel/api-client/react";
import { Button, cn, Spinner, TesselMark } from "@tessel/ui";
import { useQuery } from "@tanstack/react-query";
import { AudioLines, BarChart3, Boxes, Gauge, Menu, ScrollText, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { env } from "@/lib/env";
import { useSessionStore } from "@/lib/session-store";

const NAV = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/users", label: "Users", icon: Users },
  { href: "/models", label: "Models", icon: Boxes },
  { href: "/usage", label: "Usage", icon: BarChart3 },
  { href: "/voice", label: "Voice", icon: AudioLines },
  { href: "/audit", label: "Audit log", icon: ScrollText },
] as const;

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}

/**
 * Signed-in Tessel admins only. The API decides: every admin call checks the
 * role (and, in production, two-step sign-in) on the server.
 */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const clear = useSessionStore((state) => state.clear);
  const [menuOpen, setMenuOpen] = useState(false);
  const access = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: api.admin.overview,
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  const logOut = async () => {
    await api.auth.logout().catch(() => undefined);
    clear("logout");
  };

  if (status !== "authenticated" || access.isPending) {
    return (
      <Centered>
        <Spinner label="Loading" />
      </Centered>
    );
  }
  if (access.isError) {
    const error = toApiClientError(access.error);
    return (
      <Centered>
        <h1 className="text-2xl font-semibold tracking-tight">
          {error.code === "admin_two_factor_required"
            ? "Turn on two-step sign-in first"
            : "This account isn't a Tessel admin"}
        </h1>
        <p className="text-muted mt-2">{error.message}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {error.code === "admin_two_factor_required" ? (
            <a
              href={`${env.webUrl}/settings#two-factor`}
              className="bg-accent text-accent-ink inline-flex h-11 items-center rounded-lg px-4 font-medium"
            >
              Open Tessel settings
            </a>
          ) : null}
          <Button variant="secondary" onClick={logOut}>
            Log out
          </Button>
        </div>
      </Centered>
    );
  }

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMenuOpen(false)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
              active ? "bg-ink/8 text-ink" : "text-muted hover:bg-ink/5 hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="border-line border-t pt-4 text-sm">
      <p className="truncate px-2 font-medium">{user?.name}</p>
      <p className="text-muted truncate px-2 text-xs">{user?.email}</p>
      <div className="mt-3 flex flex-col gap-1">
        <a href={env.webUrl} className="text-muted hover:text-ink rounded-lg px-2 py-1.5">
          Back to Tessel
        </a>
        <button
          type="button"
          onClick={logOut}
          className="text-muted hover:text-ink rounded-lg px-2 py-1.5 text-left"
        >
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <header className="border-line bg-surface flex items-center justify-between border-b px-4 py-3 md:hidden">
        <span className="font-display flex items-center gap-2 font-semibold">
          <TesselMark />
          Admin
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>
      {menuOpen ? (
        <div
          id="admin-mobile-menu"
          className="border-line bg-surface flex flex-col gap-4 border-b p-3 md:hidden"
        >
          {nav}
          {account}
        </div>
      ) : null}

      <aside className="border-line bg-surface hidden w-60 shrink-0 flex-col border-r p-4 md:flex">
        <div className="font-display flex items-center gap-2.5 px-2 text-lg font-semibold">
          <TesselMark />
          Admin
        </div>
        <p className="text-muted mt-1 px-2 text-xs">Changes here apply to everyone.</p>
        <div className="mt-6">{nav}</div>
        <div className="mt-auto">{account}</div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-10">{children}</main>
    </div>
  );
}
