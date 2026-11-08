"use client";

import { useWorkspaces } from "@tessel/api-client/react";
import { useWorkspaceStore } from "@/lib/workspace-store";

/**
 * The workspace the user is working in: their last choice if they can still
 * access it, otherwise their first workspace (the personal one).
 */
export function useCurrentWorkspace() {
  const workspaces = useWorkspaces();
  const currentWorkspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);

  const list = workspaces.data ?? [];
  const current = list.find((workspace) => workspace.id === currentWorkspaceId) ?? list[0];

  return { workspaces: list, current, setCurrentWorkspace, query: workspaces };
}
