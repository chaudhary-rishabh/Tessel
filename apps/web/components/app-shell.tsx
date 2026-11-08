"use client";

import { Button, cn, Sheet } from "@tessel/ui";
import {
  FileText,
  Menu,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
  SquarePen,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { ThreadList } from "./chat/thread-list";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

const NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/connectors", label: "Connectors", icon: Plug },
  { href: "/members", label: "Members", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { current } = useCurrentWorkspace();

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <WorkspaceSwitcher />

      <Button asChild variant="secondary" className="justify-start gap-2.5">
        <Link href="/chat" onClick={onNavigate}>
          <SquarePen className="size-4" aria-hidden="true" />
          New chat
        </Link>
      </Button>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "text-ink/80 hover:bg-ink/6 hover:text-ink flex min-h-11 items-center gap-2.5 rounded-lg px-3",
                "focus-visible:outline-accent focus-visible:outline-2",
                active && "bg-ink/8 text-ink font-medium",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>

      <section aria-labelledby="recent-heading" className="min-h-0 flex-1 overflow-y-auto px-3">
        <h2 id="recent-heading" className="text-muted font-sans text-sm font-medium">
          Recent chats
        </h2>
        {current ? (
          <ThreadList workspaceId={current.id} {...(onNavigate ? { onNavigate } : {})} />
        ) : null}
      </section>

      <UserMenu {...(onNavigate ? { onNavigate } : {})} />
    </div>
  );
}

/**
 * The signed-in layout: a fixed sidebar on wide screens, and on phones a top
 * bar whose menu button opens the same sidebar as a drawer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { current } = useCurrentWorkspace();

  return (
    <div className="flex h-dvh">
      <aside className="border-line bg-paper hidden w-72 shrink-0 border-r md:block">
        <SidebarContent />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </Sheet>

      <div className="bg-surface flex min-w-0 flex-1 flex-col">
        <header className="border-line flex h-14 shrink-0 items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)] md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          <span className="font-display truncate font-semibold">{current?.name ?? "Tessel"}</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {children}
        </main>
      </div>
    </div>
  );
}
