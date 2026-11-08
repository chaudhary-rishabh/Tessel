"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  TesselMark,
} from "@tessel/ui";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useState } from "react";
import { useCurrentWorkspace } from "@/hooks/use-current-workspace";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

const ROLE_LABELS = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export function WorkspaceSwitcher() {
  const { workspaces, current, setCurrentWorkspace, query } = useCurrentWorkspace();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="hover:bg-ink/6 focus-visible:outline-accent flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 text-left outline-none focus-visible:outline-2"
          aria-label="Switch workspace"
        >
          <TesselMark className="size-8 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-display block truncate font-semibold">
              {current?.name ?? "Tessel"}
            </span>
            <span className="text-muted block truncate text-sm">
              {current
                ? current.isPersonal
                  ? "Personal workspace"
                  : ROLE_LABELS[current.role]
                : " "}
            </span>
          </span>
          {query.isPending ? (
            <Spinner />
          ) : (
            <ChevronsUpDown className="text-muted size-4 shrink-0" aria-hidden="true" />
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} onSelect={() => setCurrentWorkspace(workspace.id)}>
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {workspace.id === current?.id ? (
                <Check className="text-accent size-4" aria-label="Current workspace" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
