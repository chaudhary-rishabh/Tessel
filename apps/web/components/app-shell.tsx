"use client";

import dynamic from "next/dynamic";
import { Button, cn, Sheet, Tooltip, TooltipProvider } from "@tessel/ui";
import {
  FileText,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { useSidebarStore } from "@/lib/sidebar-store";
import { ThreadList } from "./chat/thread-list";
import { EmailReminder } from "./email-reminder";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { useVoiceStore } from "@/lib/voice-store";

// Voice mode loads only when a conversation starts: the LiveKit SDK is large.
const VoiceMode = dynamic(() => import("./voice/voice-mode").then((module) => module.VoiceMode), {
  ssr: false,
});

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/connectors", label: "Connectors", icon: Plug },
  { href: "/members", label: "Members", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** The keyboard shortcut that opens and closes the sidebar, as this device writes it. */
function shortcutLabel(): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? "⌘ ." : "Ctrl .";
}

/** Fades a label out as the sidebar folds, and back in once it has opened. */
function fade(collapsed: boolean) {
  return cn(
    "transition-opacity motion-reduce:transition-none",
    collapsed ? "opacity-0 duration-100" : "opacity-100 delay-100 duration-200",
  );
}

/*
 * Every row keeps its icon 20px from the row's left edge, and the rail is 60px
 * wide with 10px padding, so icons sit still while the sidebar folds: only the
 * width changes, and the labels are clipped and faded.
 */

function SidebarContent({
  collapsible = false,
  collapsed = false,
  toggleLabel,
  onToggle,
  onNavigate,
}: {
  /** The wide-screen sidebar, which folds to icons. The phone drawer doesn't. */
  collapsible?: boolean;
  collapsed?: boolean;
  toggleLabel: string;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { current } = useCurrentWorkspace();
  // The sidebar renders twice on phones (hidden desktop copy and drawer).
  const recentId = useId();
  const labelFade = fade(collapsed);
  const link = cn(
    "flex min-h-11 items-center overflow-hidden rounded-lg whitespace-nowrap md:min-h-10",
    "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
  );

  return (
    <div className="flex h-full flex-col gap-3 p-2.5">
      <div className="flex items-center gap-1">
        {/* The drawer focuses this button as it opens; a tooltip there would cover the workspace name. */}
        <Tooltip
          label={toggleLabel}
          shortcut={shortcutLabel()}
          side="right"
          disabled={!collapsible}
        >
          <Button
            variant="ghost"
            size="icon"
            className="text-muted hover:text-ink size-10 shrink-0"
            aria-label={toggleLabel}
            aria-expanded={collapsible ? !collapsed : true}
            onClick={onToggle}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-5" aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
        <div
          inert={collapsed}
          className={cn("min-w-0", collapsible ? "w-56 shrink-0" : "flex-1", labelFade)}
        >
          <WorkspaceSwitcher />
        </div>
      </div>

      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <Tooltip label="New chat" side="right" disabled={!collapsed}>
          <Link
            href="/chat"
            onClick={onNavigate}
            className={cn(link, "group text-ink hover:bg-ink/6 gap-1.5 px-1.5 font-medium")}
          >
            <span
              aria-hidden="true"
              className="bg-accent text-accent-ink flex size-7 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105 group-active:scale-95 motion-reduce:transition-none"
            >
              <Plus className="size-4" strokeWidth={2.5} />
            </span>
            <span className={labelFade}>New chat</span>
          </Link>
        </Tooltip>

        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Tooltip key={href} label={label} side="right" disabled={!collapsed}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  link,
                  "text-ink/80 hover:bg-ink/6 hover:text-ink gap-3 px-3",
                  active && "bg-ink/8 text-ink font-medium",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className={labelFade}>{label}</span>
              </Link>
            </Tooltip>
          );
        })}
      </nav>

      <section
        aria-labelledby={recentId}
        inert={collapsed}
        className={cn("relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto", labelFade)}
      >
        {/* A fixed width on wide screens, so the list is clipped as it folds rather than squeezed. */}
        <div className={cn("px-3", collapsible && "w-[16.75rem]")}>
          <h2 id={recentId} className="text-muted font-sans text-sm font-medium">
            Recent chats
          </h2>
          {current ? (
            <ThreadList workspaceId={current.id} {...(onNavigate ? { onNavigate } : {})} />
          ) : null}
        </div>
      </section>

      <UserMenu collapsed={collapsed} {...(onNavigate ? { onNavigate } : {})} />
    </div>
  );
}

/**
 * The signed-in layout. On wide screens a sidebar that folds down to an icon
 * rail (its button, or Ctrl/⌘ + period); on phones a top bar whose button
 * opens the same sidebar as a drawer.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useSidebarStore((state) => state.collapsed);
  const toggleCollapsed = useSidebarStore((state) => state.toggle);
  const { current } = useCurrentWorkspace();
  const sidebarId = useId();
  const voiceOpen = useVoiceStore((state) => state.request !== null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "." || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      event.preventDefault();
      if (window.matchMedia("(min-width: 48rem)").matches) toggleCollapsed();
      else setDrawerOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  return (
    <TooltipProvider>
      <div className="flex h-dvh">
        <aside
          id={sidebarId}
          aria-label="Sidebar"
          className={cn(
            "border-line bg-paper hidden shrink-0 overflow-hidden border-r md:block",
            "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            collapsed ? "w-15" : "w-72",
          )}
        >
          <SidebarContent
            collapsible
            collapsed={collapsed}
            toggleLabel={collapsed ? "Open sidebar" : "Close sidebar"}
            onToggle={toggleCollapsed}
          />
        </aside>

        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
          <SidebarContent
            toggleLabel="Close navigation"
            onToggle={() => setDrawerOpen(false)}
            onNavigate={() => setDrawerOpen(false)}
          />
        </Sheet>

        <div className="bg-surface flex min-w-0 flex-1 flex-col">
          <header className="border-line flex h-14 shrink-0 items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)] md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <PanelLeft className="size-5" aria-hidden="true" />
            </Button>
            <span className="font-display truncate font-semibold">{current?.name ?? "Tessel"}</span>
          </header>
          <EmailReminder />
          {/* relative: hidden screen-reader text is placed against this scroll box, not the page,
              so it can't stretch the page and give the window a second scrollbar. */}
          <main className="relative min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {children}
          </main>
        </div>
      </div>
      {voiceOpen ? <VoiceMode /> : null}
    </TooltipProvider>
  );
}
