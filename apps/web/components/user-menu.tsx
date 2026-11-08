"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tessel/ui";
import { LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLogout } from "@/hooks/use-auth";
import { useSessionStore } from "@/lib/session-store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const user = useSessionStore((state) => state.user);
  const logout = useLogout();
  const router = useRouter();
  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hover:bg-ink/6 focus-visible:outline-accent flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 text-left outline-none focus-visible:outline-2"
        aria-label="Account menu"
      >
        <span
          aria-hidden="true"
          className="bg-accent text-accent-ink flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{user.name}</span>
          <span className="text-muted block truncate text-sm">{user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width)"
      >
        <DropdownMenuItem
          onSelect={() => {
            onNavigate?.();
            router.push("/settings");
          }}
        >
          <Settings className="size-4" aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut className="size-4" aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
